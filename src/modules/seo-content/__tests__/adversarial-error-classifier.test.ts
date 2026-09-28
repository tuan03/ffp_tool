import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyError,
  CLASSIFIED_ERROR_ACTIONS,
  DEFAULT_JITTER_SCHEDULE,
  getJitterBackoffDelayMs,
} from "../internal/error-classifier";
import {
  executeWithClassifiedRetry,
  isGeminiRateLimitOrTransientError,
  GEMINI_RETRIES_EXHAUSTED,
} from "../internal/product-understanding/gemini-retry";

// =========================================================================
// SECTION 1: JITTER DISTRIBUTION & SCHEDULE VERIFICATION (100,000 SAMPLES)
// =========================================================================

test("JITTER HARNESS: 100,000 samples strictly respect base schedule +/- 20% and never return <= 0", () => {
  const TRIALS = 25000; // 25,000 per attempt level = 100,000 total

  const testCases = [
    { attempt: 1, base: 5000, min: 4000, max: 6000 },
    { attempt: 2, base: 15000, min: 12000, max: 18000 },
    { attempt: 3, base: 45000, min: 36000, max: 54000 },
    { attempt: 4, base: 120000, min: 96000, max: 144000 },
    { attempt: 5, base: 120000, min: 96000, max: 144000 }, // clamped to attempt 4
    { attempt: 10, base: 120000, min: 96000, max: 144000 },
    { attempt: 0, base: 5000, min: 4000, max: 6000 }, // clamped to attempt 1
    { attempt: -5, base: 5000, min: 4000, max: 6000 },
  ];

  for (const tc of testCases) {
    let sum = 0;
    let minObserved = Infinity;
    let maxObserved = -Infinity;

    for (let i = 0; i < TRIALS; i++) {
      const delay = getJitterBackoffDelayMs(tc.attempt);

      // Invariant 1: Must never return <= 0
      assert.ok(delay > 0, `Delay must be strictly positive, got ${delay} for attempt ${tc.attempt}`);

      // Invariant 2: Must never return NaN
      assert.ok(!Number.isNaN(delay), `Delay must not be NaN for attempt ${tc.attempt}`);

      // Invariant 3: Must be an integer
      assert.ok(Number.isInteger(delay), `Delay must be an integer, got ${delay}`);

      // Invariant 4: Must be within +/- 20% bounds
      assert.ok(
        delay >= tc.min,
        `Delay ${delay} below min bound ${tc.min} for attempt ${tc.attempt}`,
      );
      assert.ok(
        delay <= tc.max,
        `Delay ${delay} exceeds max bound ${tc.max} for attempt ${tc.attempt}`,
      );

      sum += delay;
      if (delay < minObserved) minObserved = delay;
      if (delay > maxObserved) maxObserved = delay;
    }

    const mean = sum / TRIALS;
    // Mean should be within 1.5% of base delay
    const relativeDeviation = Math.abs(mean - tc.base) / tc.base;
    assert.ok(
      relativeDeviation < 0.015,
      `Mean ${mean} deviates too much from base ${tc.base} (deviation: ${relativeDeviation})`,
    );

    // Spread test: min observed should approach 0.8 * base, max should approach 1.2 * base
    assert.ok(minObserved <= tc.min + (tc.base * 0.02), `Min observed ${minObserved} did not approach lower bound ${tc.min}`);
    assert.ok(maxObserved >= tc.max - (tc.base * 0.02), `Max observed ${maxObserved} did not approach upper bound ${tc.max}`);
  }
});

test("JITTER HARNESS: Edge-case inputs for getJitterBackoffDelayMs", () => {
  // Empty schedule returns fallback 1000
  assert.equal(getJitterBackoffDelayMs(1, []), 1000);

  // Custom schedule
  const customSchedule = [100, 200, 300];
  const delayCustom = getJitterBackoffDelayMs(2, customSchedule, () => 0.5);
  assert.equal(delayCustom, 200);

  // Extreme randomFn outputs are clamped by Math.max(0, Math.min(1, ...))
  assert.equal(getJitterBackoffDelayMs(1, DEFAULT_JITTER_SCHEDULE, () => -1), 4000);
  assert.equal(getJitterBackoffDelayMs(1, DEFAULT_JITTER_SCHEDULE, () => 99), 6000);

  // Note on NaN input: Math.max(1, Math.floor(NaN)) -> NaN -> returns NaN
  assert.ok(Number.isNaN(getJitterBackoffDelayMs(NaN)));
});

// =========================================================================
// SECTION 2: OBSCURE ERROR FORMATS & REAL-WORLD SDK PATTERNS
// =========================================================================

test("OBSCURE ERRORS: Google GenAI SDK & Vertex AI error patterns", () => {
  // Pattern 1: Google GenAI SDK ApiError with errorDetails (RESOURCE_EXHAUSTED)
  const genAiResourceExhausted = {
    name: "GoogleGenAIError",
    status: 429,
    statusText: "Too Many Requests",
    errorDetails: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "RESOURCE_EXHAUSTED",
        domain: "googleapis.com",
      },
    ],
  };
  const res1 = classifyError(genAiResourceExhausted);
  assert.equal(res1.action, CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT);
  assert.equal(res1.isRetryable, true);

  // Pattern 2: GoogleGenAI error string format "[429 Too Many Requests] Resource has been exhausted"
  const genAiStringErr = new Error("[429 Too Many Requests] Resource has been exhausted (e.g. check quota).");
  const res2 = classifyError(genAiStringErr);
  assert.equal(res2.action, CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT);
  assert.equal(res2.isRetryable, true);

  // Pattern 3: Google GenAI Model not found "[404 Not Found] models/gemini-2.5-pro is not found for API version v1"
  const genAiMissingModel = new Error("[404 Not Found] models/gemini-2.5-pro is not found for API version v1");
  const res3 = classifyError(genAiMissingModel);
  assert.equal(
    res3.action,
    CLASSIFIED_ERROR_ACTIONS.CIRCUIT_BREAKER_MISSING_MODEL,
    "GenAI SDK error '[404 Not Found] models/...' must be classified as CIRCUIT_BREAKER_MISSING_MODEL",
  );
  assert.equal(res3.isRetryable, false);

  // Pattern 4: Google Cloud REST API body wrapped in error
  const gcpWrappedErr = {
    error: {
      code: 503,
      message: "The model is overloaded. Please try again later.",
      status: "UNAVAILABLE",
    },
  };
  const res4 = classifyError(gcpWrappedErr);
  assert.equal(res4.action, CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY);
  assert.equal(res4.isRetryable, true);

  // Pattern 5: Google safety block via promptFeedback
  const safetyBlockFeedback = {
    promptFeedback: {
      blockReason: "SAFETY",
      safetyRatings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" },
      ],
    },
    message: "Candidate was blocked due to SAFETY_RATINGS",
  };
  const res5 = classifyError(safetyBlockFeedback);
  assert.equal(res5.action, CLASSIFIED_ERROR_ACTIONS.SAFETY_MANUAL_REVIEW);
  assert.equal(res5.isRetryable, false);

  // Pattern 6: Google ADC credential failure
  const adcErr = new Error("Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started");
  const res6 = classifyError(adcErr);
  assert.equal(res6.action, CLASSIFIED_ERROR_ACTIONS.QUEUE_PAUSE_CREDENTIAL_ERROR);
  assert.equal(res6.isRetryable, false);
});

test("OBSCURE ERRORS: Axios error formats", () => {
  // Pattern 1: Standard Axios 429 error where status is in message & response
  const axios429 = {
    name: "AxiosError",
    message: "Request failed with status code 429",
    code: "ERR_BAD_REQUEST",
    response: {
      status: 429,
      statusText: "Too Many Requests",
      data: {
        error: {
          code: 429,
          message: "Resource has been exhausted",
          status: "RESOURCE_EXHAUSTED",
        },
      },
    },
  };
  const res1 = classifyError(axios429);
  assert.equal(res1.action, CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT);
  assert.equal(res1.isRetryable, true);

  // Pattern 2: Axios timeout (ECONNABORTED)
  const axiosTimeout = {
    name: "AxiosError",
    message: "timeout of 30000ms exceeded",
    code: "ECONNABORTED",
  };
  const res2 = classifyError(axiosTimeout);
  assert.equal(res2.action, CLASSIFIED_ERROR_ACTIONS.TIMEOUT_RETRY);
  assert.equal(res2.isRetryable, true);

  // Pattern 3: Axios error where status is ONLY in response.status and message is generic 'Network Error'
  const axios503GenericMsg = {
    name: "AxiosError",
    message: "Network Error",
    response: {
      status: 503,
      statusText: "Service Unavailable",
    },
  };
  const res3 = classifyError(axios503GenericMsg);
  assert.equal(
    res3.action,
    CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY,
    "Axios response.status 503 must be inspected and classified as TRANSIENT_RETRY",
  );
  assert.equal(res3.isRetryable, true);
  assert.equal(isGeminiRateLimitOrTransientError(axios503GenericMsg), true);

  // Pattern 4: Axios 413 Payload Too Large
  const axios413 = {
    name: "AxiosError",
    message: "Request failed with status code 413",
    status: 413,
    response: {
      status: 413,
      data: "Request entity too large",
    },
  };
  const res4 = classifyError(axios413);
  assert.equal(res4.action, CLASSIFIED_ERROR_ACTIONS.INPUT_TOO_LARGE_REJECT);
  assert.equal(res4.isRetryable, false);
});

test("OBSCURE ERRORS: Fetch TypeError, AbortError, and Network failures", () => {
  // Pattern 1: Node.js fetch failed with ECONNRESET cause
  const fetchConnReset = new TypeError("fetch failed");
  (fetchConnReset as unknown as { cause: unknown }).cause = { code: "ECONNRESET", message: "read ECONNRESET" };
  const res1 = classifyError(fetchConnReset);
  assert.equal(res1.action, CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY);
  assert.equal(res1.isRetryable, true);

  // Pattern 2: Node.js fetch failed with ConnectTimeoutError cause
  const fetchTimeout = new TypeError("fetch failed");
  (fetchTimeout as unknown as { cause: unknown }).cause = {
    name: "ConnectTimeoutError",
    code: "UND_ERR_CONNECT_TIMEOUT",
    message: "Connect Timeout Error",
  };
  const res2 = classifyError(fetchTimeout);
  assert.equal(res2.action, CLASSIFIED_ERROR_ACTIONS.TIMEOUT_RETRY);
  assert.equal(res2.isRetryable, true);

  // Pattern 3: AbortError (DOMException)
  const abortErr = new Error("This operation was aborted");
  abortErr.name = "AbortError";
  const res3 = classifyError(abortErr);
  // Abort should NOT be retryable
  assert.equal(res3.isRetryable, false);
  assert.equal(res3.maxRetries, 0);

  // Pattern 4: Browser fetch failure "TypeError: Failed to fetch"
  const browserFetchErr = new TypeError("Failed to fetch");
  const res4 = classifyError(browserFetchErr);
  assert.equal(
    res4.action,
    CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY,
    "Browser TypeError('Failed to fetch') must be classified as TRANSIENT_RETRY",
  );
  assert.equal(res4.isRetryable, true);
  assert.equal(
    isGeminiRateLimitOrTransientError(browserFetchErr),
    true,
    "isGeminiRateLimitOrTransientError must return true for browser TypeError('Failed to fetch')",
  );
});

test("OBSCURE ERRORS: Nested Cause Chains & Circular References", () => {
  // 1. Multi-level cause chain: Level 1 -> Level 2 -> Level 3 (429)
  const level3 = { status: 429, message: "RESOURCE_EXHAUSTED" };
  const level2 = new Error("Stage B1 failed", { cause: level3 });
  const level1 = new Error("Pipeline run failed", { cause: level2 });

  const res1 = classifyError(level1);
  assert.equal(res1.action, CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT);
  assert.equal(res1.isRetryable, true);

  // 2. Multi-level cause chain: Level 1 -> Level 2 -> Level 3 (Timeout)
  const timeoutL3 = new Error("Request timed out");
  timeoutL3.name = "TimeoutError";
  const timeoutL2 = new Error("Gemini invocation failed", { cause: timeoutL3 });
  const timeoutL1 = new Error("Pipeline execution failed", { cause: timeoutL2 });

  const res2 = classifyError(timeoutL1);
  assert.equal(res2.action, CLASSIFIED_ERROR_ACTIONS.TIMEOUT_RETRY);
  assert.equal(res2.isRetryable, true);

  // 3. String cause or primitive cause
  const errWithStrCause = new Error("Top error", { cause: "503 Service Unavailable" } as ErrorOptions);
  const res3 = classifyError(errWithStrCause);
  assert.equal(
    res3.action,
    CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY,
    "String cause '503 Service Unavailable' must be inspected and classified as TRANSIENT_RETRY",
  );

  // 4. Circular cause reference (A -> B -> A)
  // Must NOT crash with RangeError: Maximum call stack size exceeded
  const errA = new Error("Error A") as Error & { cause?: unknown };
  const errB = new Error("Error B") as Error & { cause?: unknown };
  errA.cause = errB;
  errB.cause = errA;

  assert.doesNotThrow(() => {
    const res = classifyError(errA);
    assert.ok(res.action);
  }, "classifyError must not throw RangeError on circular causes");

  assert.doesNotThrow(() => {
    const isTransient = isGeminiRateLimitOrTransientError(errA);
    assert.equal(typeof isTransient, "boolean");
  }, "isGeminiRateLimitOrTransientError must not throw RangeError on circular causes");
});

// =========================================================================
// SECTION 3: EMPIRICAL VERIFICATION OF NON-RETRYABLE ABORT BEHAVIOR
// =========================================================================

test("NON-RETRYABLE ABORT: Verify all non-retryable categories abort immediately without any retry attempts", async () => {
  const nonRetryableTestCases = [
    {
      category: "FATAL_INVALID_CONFIG",
      error: new Error("Invalid configuration: negative token count"),
      expectedAction: CLASSIFIED_ERROR_ACTIONS.FATAL_INVALID_CONFIG,
    },
    {
      category: "INPUT_TOO_LARGE_REJECT (413)",
      error: { status: 413, message: "Payload too large: 20MB exceeds maximum allowed" },
      expectedAction: CLASSIFIED_ERROR_ACTIONS.INPUT_TOO_LARGE_REJECT,
    },
    {
      category: "INPUT_TOO_LARGE_REJECT (Context window)",
      error: new Error("Context window exceeded: input token limit exceeded"),
      expectedAction: CLASSIFIED_ERROR_ACTIONS.INPUT_TOO_LARGE_REJECT,
    },
    {
      category: "QUEUE_PAUSE_CREDENTIAL_ERROR (ADC)",
      error: new Error("Could not load the default credentials"),
      expectedAction: CLASSIFIED_ERROR_ACTIONS.QUEUE_PAUSE_CREDENTIAL_ERROR,
    },
    {
      category: "QUEUE_PAUSE_CREDENTIAL_ERROR (401)",
      error: { status: 401, message: "UNAUTHENTICATED request" },
      expectedAction: CLASSIFIED_ERROR_ACTIONS.QUEUE_PAUSE_CREDENTIAL_ERROR,
    },
    {
      category: "CIRCUIT_BREAKER_MISSING_MODEL (404 models/)",
      error: { status: 404, message: "models/gemini-2.0-flash not found" },
      expectedAction: CLASSIFIED_ERROR_ACTIONS.CIRCUIT_BREAKER_MISSING_MODEL,
    },
    {
      category: "SAFETY_MANUAL_REVIEW (finishReason)",
      error: { finishReason: "SAFETY", message: "Candidate blocked by safety filters" },
      expectedAction: CLASSIFIED_ERROR_ACTIONS.SAFETY_MANUAL_REVIEW,
    },
    {
      category: "IMAGE_NOT_FOUND_DROP",
      error: new Error("Failed to load image: product.jpg returned HTTP 404"),
      expectedAction: CLASSIFIED_ERROR_ACTIONS.IMAGE_NOT_FOUND_DROP,
    },
  ];

  for (const tc of nonRetryableTestCases) {
    let callCount = 0;
    let sleepInvoked = false;
    let retryCallbackInvoked = false;

    await assert.rejects(
      async () => {
        await executeWithClassifiedRetry(
          async () => {
            callCount++;
            throw tc.error;
          },
          {
            sleepFn: async () => {
              sleepInvoked = true;
            },
            onRetry: () => {
              retryCallbackInvoked = true;
            },
          },
        );
      },
      (err: unknown) => {
        assert.equal(err, tc.error);
        return true;
      },
    );

    // Invariants:
    // 1. Must be called exactly once
    assert.equal(
      callCount,
      1,
      `Non-retryable error [${tc.category}] must execute action exactly once (got ${callCount})`,
    );

    // 2. Must never sleep/backoff
    assert.equal(
      sleepInvoked,
      false,
      `Non-retryable error [${tc.category}] must NEVER invoke sleepFn`,
    );

    // 3. Must never trigger onRetry
    assert.equal(
      retryCallbackInvoked,
      false,
      `Non-retryable error [${tc.category}] must NEVER invoke onRetry callback`,
    );

    // 4. Must tag error as retries exhausted
    assert.equal(
      (tc.error as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED],
      true,
      `Non-retryable error [${tc.category}] must be tagged with GEMINI_RETRIES_EXHAUSTED`,
    );
  }
});

// =========================================================================
// SECTION 4: RETRYABLE CATEGORIES & RETRY LIMIT HARNESS
// =========================================================================

test("RETRYABLE HARNESS: Exactly respects maxRetries limits per category", async () => {
  const retryableCases = [
    {
      category: "TRUNCATED_JSON_RECOMPACT",
      error: new SyntaxError("Unexpected end of JSON input"),
      expectedMaxRetries: 1,
      expectedTotalCalls: 2, // 1 initial + 1 retry
    },
    {
      category: "TRANSIENT_RETRY (503)",
      error: { status: 503, message: "Service Unavailable" },
      expectedMaxRetries: 3,
      expectedTotalCalls: 4, // 1 initial + 3 retries
    },
    {
      category: "TIMEOUT_RETRY",
      error: { status: 408, message: "Request Timeout" },
      expectedMaxRetries: 3,
      expectedTotalCalls: 4, // 1 initial + 3 retries
    },
    {
      category: "THROTTLE_RATE_LIMIT (429)",
      error: { status: 429, message: "RESOURCE_EXHAUSTED" },
      expectedMaxRetries: 4,
      expectedTotalCalls: 5, // 1 initial + 4 retries
    },
  ];

  for (const tc of retryableCases) {
    let callCount = 0;
    const delays: number[] = [];

    await assert.rejects(
      async () => {
        await executeWithClassifiedRetry(
          async () => {
            callCount++;
            throw tc.error;
          },
          {
            randomFn: () => 0.5, // 1.0 factor -> exact base delays
            sleepFn: async (ms) => {
              delays.push(ms);
            },
          },
        );
      },
      (err: unknown) => {
        assert.equal(err, tc.error);
        return true;
      },
    );

    assert.equal(
      callCount,
      tc.expectedTotalCalls,
      `Category [${tc.category}] total calls expected ${tc.expectedTotalCalls}, got ${callCount}`,
    );
    assert.equal(
      delays.length,
      tc.expectedMaxRetries,
      `Category [${tc.category}] delays count expected ${tc.expectedMaxRetries}, got ${delays.length}`,
    );
  }
});
