import assert from "node:assert/strict";
import test from "node:test";

import {
  executeWithExponentialBackoff,
  isGeminiRateLimitOrTransientError,
  GEMINI_RETRIES_EXHAUSTED,
} from "../internal/product-understanding/gemini-retry";
import { GeminiGeneratorError } from "../internal/product-understanding/gemini-content-generator";

test("isGeminiRateLimitOrTransientError accurately classifies transient vs permanent errors", () => {
  // Transient status codes (number and string)
  assert.equal(isGeminiRateLimitOrTransientError({ status: 429 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ status: 503 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ status: 504 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ statusCode: 429 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ code: 429 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ status: "429" }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ status: "RESOURCE_EXHAUSTED" }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ status: "UNAVAILABLE" }), true);

  // gRPC status codes (4: DEADLINE_EXCEEDED, 8: RESOURCE_EXHAUSTED, 14: UNAVAILABLE)
  assert.equal(isGeminiRateLimitOrTransientError({ code: 8 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ code: 14 }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ code: 4 }), true);

  // Plain objects with message (deserialized JSON / non-Error instances)
  assert.equal(isGeminiRateLimitOrTransientError({ message: "429 Too Many Requests" }), true);
  assert.equal(isGeminiRateLimitOrTransientError({ message: "Resource exhausted" }), false);
  assert.equal(isGeminiRateLimitOrTransientError({ message: "Quota exceeded for quota metric 'Queries'" }), true);

  // Google Cloud REST API error payload structure
  assert.equal(
    isGeminiRateLimitOrTransientError({
      error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" },
    }),
    true,
  );

  // Transient messages / keywords
  assert.equal(isGeminiRateLimitOrTransientError(new Error("429 RESOURCE_EXHAUSTED")), true);
  assert.equal(isGeminiRateLimitOrTransientError(new Error("The service is UNAVAILABLE")), true);
  assert.equal(isGeminiRateLimitOrTransientError(new Error("rate limit exceeded")), true);
  assert.equal(isGeminiRateLimitOrTransientError(new Error("request ETIMEDOUT")), true);
  assert.equal(isGeminiRateLimitOrTransientError(new Error("Quota exceeded")), true);

  // GeminiGeneratorError
  assert.equal(isGeminiRateLimitOrTransientError(new GeminiGeneratorError("Timeout", 408, true)), true);
  assert.equal(isGeminiRateLimitOrTransientError(new GeminiGeneratorError("Rate limit", 429, false)), true);

  // Nested cause
  const nestedError = new Error("Wrapper error");
  (nestedError as unknown as { cause: unknown }).cause = new Error("429 RESOURCE_EXHAUSTED");
  assert.equal(isGeminiRateLimitOrTransientError(nestedError), true);

  // Non-transient errors
  assert.equal(isGeminiRateLimitOrTransientError({ status: 400 }), false);
  assert.equal(isGeminiRateLimitOrTransientError({ status: 401 }), false);
  assert.equal(isGeminiRateLimitOrTransientError({ status: 404 }), false);
  assert.equal(isGeminiRateLimitOrTransientError(new Error("Invalid prompt argument")), false);
  assert.equal(isGeminiRateLimitOrTransientError(null), false);
  assert.equal(isGeminiRateLimitOrTransientError(undefined), false);

  // Exhausted error should not be retried again
  const exhaustedError = new Error("429 RESOURCE_EXHAUSTED");
  (exhaustedError as unknown as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED] = true;
  assert.equal(isGeminiRateLimitOrTransientError(exhaustedError), false);
});

test("executeWithExponentialBackoff succeeds on first attempt without delay", async () => {
  let callCount = 0;
  const sleepCalls: number[] = [];

  const result = await executeWithExponentialBackoff(
    async () => {
      callCount++;
      return "success";
    },
    {
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    },
  );

  assert.equal(result, "success");
  assert.equal(callCount, 1);
  assert.equal(sleepCalls.length, 0);
});

test("executeWithExponentialBackoff retries and succeeds after 429 errors with exponential delays", async () => {
  let callCount = 0;
  const sleepCalls: number[] = [];
  const retryEvents: Array<{ attempt: number; delayMs: number }> = [];

  const result = await executeWithExponentialBackoff(
    async () => {
      callCount++;
      if (callCount === 1) {
        throw new GeminiGeneratorError("429 RESOURCE_EXHAUSTED", 429, true);
      }
      if (callCount === 2) {
        throw new Error("HTTP 429 rate limit");
      }
      return "recovered";
    },
    {
      initialDelayMs: 2500,
      backoffMultiplier: 2,
      jitterMs: 100,
      randomFn: () => 0.5, // deterministic jitter: 50ms
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
      onRetry: (_err, attempt, delayMs) => {
        retryEvents.push({ attempt, delayMs });
      },
    },
  );

  assert.equal(result, "recovered");
  assert.equal(callCount, 3);
  assert.equal(sleepCalls.length, 2);

  // Attempt 1 delay: 2500 * (2^0) + 50 = 2550
  assert.equal(sleepCalls[0], 2550);
  // Attempt 2 delay: 2500 * (2^1) + 50 = 5050
  assert.equal(sleepCalls[1], 5050);

  assert.deepEqual(retryEvents, [
    { attempt: 1, delayMs: 2550 },
    { attempt: 2, delayMs: 5050 },
  ]);
});

test("executeWithExponentialBackoff fails immediately on non-transient errors", async () => {
  let callCount = 0;
  const sleepCalls: number[] = [];

  await assert.rejects(
    async () => {
      await executeWithExponentialBackoff(
        async () => {
          callCount++;
          throw new GeminiGeneratorError("400 Bad Request", 400, false);
        },
        {
          sleepFn: async (ms) => {
            sleepCalls.push(ms);
          },
        },
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof GeminiGeneratorError);
      assert.equal(err.status, 400);
      return true;
    },
  );

  assert.equal(callCount, 1);
  assert.equal(sleepCalls.length, 0);
});

test("executeWithExponentialBackoff throws after exhausting maxRetries and flags error", async () => {
  let callCount = 0;
  const sleepCalls: number[] = [];

  await assert.rejects(
    async () => {
      await executeWithExponentialBackoff(
        async () => {
          callCount++;
          throw new Error("429 RESOURCE_EXHAUSTED");
        },
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          jitterMs: 0,
          sleepFn: async (ms) => {
            sleepCalls.push(ms);
          },
        },
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "429 RESOURCE_EXHAUSTED");
      assert.equal((err as unknown as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED], true);
      return true;
    },
  );

  // 1 initial attempt + 3 retries = 4 calls
  assert.equal(callCount, 4);
  assert.equal(sleepCalls.length, 3);
  assert.deepEqual(sleepCalls, [1000, 2000, 4000]);
});

test("executeWithExponentialBackoff prevents nested double-retry when inner error already exhausted retries", async () => {
  let innerCalls = 0;
  let outerRetries = 0;

  await assert.rejects(
    async () => {
      await executeWithExponentialBackoff(
        async () => {
          return executeWithExponentialBackoff(
            async () => {
              innerCalls++;
              throw new Error("429 RESOURCE_EXHAUSTED");
            },
            {
              maxRetries: 2,
              sleepFn: async () => {},
            },
          );
        },
        {
          maxRetries: 3,
          sleepFn: async () => {},
          onRetry: () => {
            outerRetries++;
          },
        },
      );
    },
    /429 RESOURCE_EXHAUSTED/,
  );

  // Inner called 1 + 2 = 3 times
  assert.equal(innerCalls, 3);
  // Outer should not have retried at all because inner exhausted retries
  assert.equal(outerRetries, 0);
});

test("executeWithExponentialBackoff handles frozen error objects safely without throwing TypeError", async () => {
  let callCount = 0;
  const frozenError = Object.freeze(new Error("429 RESOURCE_EXHAUSTED"));

  await assert.rejects(
    async () => {
      await executeWithExponentialBackoff(
        async () => {
          callCount++;
          throw frozenError;
        },
        {
          maxRetries: 1,
          sleepFn: async () => {},
        },
      );
    },
    (err: unknown) => {
      assert.equal(err, frozenError);
      return true;
    },
  );

  assert.equal(callCount, 2);
});

