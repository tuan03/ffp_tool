import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyError,
  CLASSIFIED_ERROR_ACTIONS,
  getJitterBackoffDelayMs,
} from "../internal/error-classifier";
import {
  executeWithClassifiedRetry,
  GEMINI_RETRIES_EXHAUSTED,
} from "../internal/product-understanding/gemini-retry";

test("classifyError correctly identifies all 10 error categories", () => {
  // 1. THROTTLE_RATE_LIMIT (Gemini 429)
  const rateLimitErr1 = { status: 429, message: "RESOURCE_EXHAUSTED: quota exceeded" };
  const res1 = classifyError(rateLimitErr1);
  assert.equal(res1.action, CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT);
  assert.equal(res1.isRetryable, true);
  assert.equal(res1.maxRetries, 4);

  const rateLimitErr2 = new Error("429 Too Many Requests");
  assert.equal(classifyError(rateLimitErr2).action, CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT);

  // 2. TRANSIENT_RETRY (Gemini 5xx / UNAVAILABLE)
  const transientErr1 = { status: 503, message: "Service Unavailable" };
  const res2 = classifyError(transientErr1);
  assert.equal(res2.action, CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY);
  assert.equal(res2.isRetryable, true);
  assert.equal(res2.maxRetries, 3);

  const transientErr2 = { code: 14, message: "The service is UNAVAILABLE" };
  assert.equal(classifyError(transientErr2).action, CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY);

  // 3. TIMEOUT_RETRY (HTTP / Stage timeout)
  const timeoutErr1 = new Error("Provider request timed out");
  timeoutErr1.name = "TimeoutError";
  const res3 = classifyError(timeoutErr1);
  assert.equal(res3.action, CLASSIFIED_ERROR_ACTIONS.TIMEOUT_RETRY);
  assert.equal(res3.isRetryable, true);
  assert.equal(res3.maxRetries, 3);

  const timeoutErr2 = { status: 408, message: "Request Timeout" };
  assert.equal(classifyError(timeoutErr2).action, CLASSIFIED_ERROR_ACTIONS.TIMEOUT_RETRY);

  // 4. TRUNCATED_JSON_RECOMPACT (Truncated JSON / MAX_TOKENS)
  const truncatedErr1 = new SyntaxError("Unexpected end of JSON input");
  const res4 = classifyError(truncatedErr1);
  assert.equal(res4.action, CLASSIFIED_ERROR_ACTIONS.TRUNCATED_JSON_RECOMPACT);
  assert.equal(res4.isRetryable, true);
  assert.equal(res4.maxRetries, 1);
  assert.equal(res4.retryStrategy, "recompact_prompt");

  const truncatedErr2 = { finishReason: "MAX_TOKENS", message: "Output was truncated" };
  assert.equal(classifyError(truncatedErr2).action, CLASSIFIED_ERROR_ACTIONS.TRUNCATED_JSON_RECOMPACT);

  // 5. INPUT_TOO_LARGE_REJECT (Payload 413 / Context window exceeded)
  const payloadTooLargeErr = { status: 413, message: "Request payload size exceeds limit: 15MB > 10MB" };
  const res5 = classifyError(payloadTooLargeErr);
  assert.equal(res5.action, CLASSIFIED_ERROR_ACTIONS.INPUT_TOO_LARGE_REJECT);
  assert.equal(res5.isRetryable, false);
  assert.equal(res5.maxRetries, 0);

  const contextExceededErr = new Error("Context window exceeded: input token limit exceeded");
  assert.equal(classifyError(contextExceededErr).action, CLASSIFIED_ERROR_ACTIONS.INPUT_TOO_LARGE_REJECT);

  // 6. IMAGE_NOT_FOUND_DROP (Image 404 / Corrupt buffer)
  const imageNotFoundErr = new Error("Failed to load image: https://cdn.shopify.com/product-image.webp returned HTTP 404");
  const res6 = classifyError(imageNotFoundErr);
  assert.equal(res6.action, CLASSIFIED_ERROR_ACTIONS.IMAGE_NOT_FOUND_DROP);
  assert.equal(res6.isRetryable, false);
  assert.equal(res6.retryStrategy, "drop_image");

  const corruptImageErr = new Error("Corrupted image buffer for hero.jpg");
  assert.equal(classifyError(corruptImageErr).action, CLASSIFIED_ERROR_ACTIONS.IMAGE_NOT_FOUND_DROP);

  // 7. SAFETY_MANUAL_REVIEW (Gemini safety refusal)
  const safetyErr1 = { finishReason: "SAFETY", message: "Candidate blocked by safety filters" };
  const res7 = classifyError(safetyErr1);
  assert.equal(res7.action, CLASSIFIED_ERROR_ACTIONS.SAFETY_MANUAL_REVIEW);
  assert.equal(res7.isRetryable, false);
  assert.equal(res7.maxRetries, 0);

  const safetyErr2 = new Error("Generation halted: BLOCK_REASON_SAFETY triggered for HARM_CATEGORY_HATE_SPEECH");
  assert.equal(classifyError(safetyErr2).action, CLASSIFIED_ERROR_ACTIONS.SAFETY_MANUAL_REVIEW);

  // 8. CIRCUIT_BREAKER_MISSING_MODEL (Missing model / 404)
  const missingModelErr = {
    status: 404,
    message: "Publisher Model models/gemini-2.5-flash not found in region us-central1",
  };
  const res8 = classifyError(missingModelErr);
  assert.equal(res8.action, CLASSIFIED_ERROR_ACTIONS.CIRCUIT_BREAKER_MISSING_MODEL);
  assert.equal(res8.isRetryable, false);
  assert.equal(res8.maxRetries, 0);

  // 9. QUEUE_PAUSE_CREDENTIAL_ERROR (ADC / Auth error)
  const adcErr = new Error("Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.");
  const res9 = classifyError(adcErr);
  assert.equal(res9.action, CLASSIFIED_ERROR_ACTIONS.QUEUE_PAUSE_CREDENTIAL_ERROR);
  assert.equal(res9.isRetryable, false);
  assert.equal(res9.maxRetries, 0);

  const auth401Err = { status: 401, message: "UNAUTHENTICATED: Request had invalid authentication credentials." };
  assert.equal(classifyError(auth401Err).action, CLASSIFIED_ERROR_ACTIONS.QUEUE_PAUSE_CREDENTIAL_ERROR);

  // 10. FATAL_INVALID_CONFIG (Invalid configuration / Bad argument)
  const invalidConfigErr = new Error("Invalid configuration: negative token budget specified");
  const res10 = classifyError(invalidConfigErr);
  assert.equal(res10.action, CLASSIFIED_ERROR_ACTIONS.FATAL_INVALID_CONFIG);
  assert.equal(res10.isRetryable, false);
  assert.equal(res10.maxRetries, 0);
});

test("getJitterBackoffDelayMs calculates exact 5s -> 15s -> 45s -> 120s schedule with +/- 20% jitter", () => {
  // Test deterministic midpoint (randomFn = () => 0.5 gives 0.8 + 0.5 * 0.4 = 1.0 factor)
  const midRandom = () => 0.5;

  assert.equal(getJitterBackoffDelayMs(1, undefined, midRandom), 5000);
  assert.equal(getJitterBackoffDelayMs(2, undefined, midRandom), 15000);
  assert.equal(getJitterBackoffDelayMs(3, undefined, midRandom), 45000);
  assert.equal(getJitterBackoffDelayMs(4, undefined, midRandom), 120000);
  // 5th attempt clamps to the last schedule item (120s)
  assert.equal(getJitterBackoffDelayMs(5, undefined, midRandom), 120000);

  // Clamping for zero/negative attempts
  assert.equal(getJitterBackoffDelayMs(0, undefined, midRandom), 5000);
  assert.equal(getJitterBackoffDelayMs(-1, undefined, midRandom), 5000);

  // Test minimum jitter bound (randomFn = () => 0 gives 0.8 factor, -20%)
  const minRandom = () => 0;
  assert.equal(getJitterBackoffDelayMs(1, undefined, minRandom), 4000);
  assert.equal(getJitterBackoffDelayMs(2, undefined, minRandom), 12000);
  assert.equal(getJitterBackoffDelayMs(3, undefined, minRandom), 36000);
  assert.equal(getJitterBackoffDelayMs(4, undefined, minRandom), 96000);

  // Test maximum jitter bound (randomFn = () => 1 gives 1.2 factor, +20%)
  const maxRandom = () => 1;
  assert.equal(getJitterBackoffDelayMs(1, undefined, maxRandom), 6000);
  assert.equal(getJitterBackoffDelayMs(2, undefined, maxRandom), 18000);
  assert.equal(getJitterBackoffDelayMs(3, undefined, maxRandom), 54000);
  assert.equal(getJitterBackoffDelayMs(4, undefined, maxRandom), 144000);
});

test("executeWithClassifiedRetry succeeds immediately when no error is thrown", async () => {
  let calls = 0;
  const result = await executeWithClassifiedRetry(async () => {
    calls++;
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("executeWithClassifiedRetry retries on 429 rate limit following jitter schedule", async () => {
  let calls = 0;
  const delays: number[] = [];

  const result = await executeWithClassifiedRetry(
    async () => {
      calls++;
      if (calls === 1) {
        throw { status: 429, message: "RESOURCE_EXHAUSTED" };
      }
      if (calls === 2) {
        throw new Error("HTTP 429 Rate limit exceeded");
      }
      return "recovered";
    },
    {
      randomFn: () => 0.5, // 1.0 factor -> 5000ms, 15000ms
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    },
  );

  assert.equal(result, "recovered");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5000, 15000]);
});

test("executeWithClassifiedRetry rejects non-retryable errors immediately without backoff", async () => {
  const nonRetryableErrors = [
    { status: 413, message: "Payload size exceeds limit" }, // INPUT_TOO_LARGE_REJECT
    new Error("Could not load the default credentials"), // QUEUE_PAUSE_CREDENTIAL_ERROR
    { status: 404, message: "models/gemini-2.5-flash not found" }, // CIRCUIT_BREAKER_MISSING_MODEL
    { finishReason: "SAFETY", message: "Blocked by safety filter" }, // SAFETY_MANUAL_REVIEW
    new Error("Invalid configuration: bad parameter"), // FATAL_INVALID_CONFIG
  ];

  for (const err of nonRetryableErrors) {
    let calls = 0;
    await assert.rejects(
      async () => {
        await executeWithClassifiedRetry(
          async () => {
            calls++;
            throw err;
          },
          {
            sleepFn: async () => {},
          },
        );
      },
      (thrownErr: unknown) => {
        assert.equal(thrownErr, err);
        return true;
      },
    );
    assert.equal(calls, 1, "Must fail on 1st attempt with 0 retries");
  }
});

test("executeWithClassifiedRetry allows max 1 retry for TRUNCATED_JSON_RECOMPACT", async () => {
  let calls = 0;
  const delays: number[] = [];

  await assert.rejects(
    async () => {
      await executeWithClassifiedRetry(
        async () => {
          calls++;
          throw new SyntaxError("Unexpected end of JSON input");
        },
        {
          randomFn: () => 0.5,
          sleepFn: async (ms) => {
            delays.push(ms);
          },
        },
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof SyntaxError);
      assert.equal((err as unknown as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED], true);
      return true;
    },
  );

  // 1 initial attempt + 1 retry = 2 calls total
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
  assert.equal(delays[0], 5000);
});
