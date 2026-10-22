import { z } from "zod";

import { generateReviewSamples, REVIEW_PROMPT } from "./amazon-reviews-generator";
import type { GenerateReviewInput, RawReviewSample } from "./amazon-reviews-generator";
import type { ReviewTextPhase, ReviewTextResult, ReviewTextStatus } from "./review-text-repository";

const sampleSchema = z.object({ author: z.string(), body: z.string(), rating: z.number(), variantText: z.string(), verifiedPurchase: z.boolean() });
export function parseChatGptSamples(answer: string): RawReviewSample[] {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { throw new Error("REVIEW_INVALID_JSON"); }
  const envelope = z.object({ samples: z.array(z.unknown()).max(50) }).safeParse(parsed);
  if (!envelope.success) throw new Error("REVIEW_INVALID_JSON");
  return envelope.data.samples.map(sample => {
    const checked = sampleSchema.safeParse(sample);
    return checked.success ? checked.data : { author: "", body: "", rating: 0, variantText: "", verifiedPurchase: true };
  });
}

export function createBridgeReviewGenerator(options: { baseUrl: string; token: string }) {
  return async (input: GenerateReviewInput, id: string, signal: AbortSignal, progress: (status: ReviewTextStatus, phase?: ReviewTextPhase) => Promise<void>): Promise<ReviewTextResult> => {
    return generateReviewSamples(input, async (plans, context, repair) => {
      signal.throwIfAborted(); await progress("queued");
      const prompt = `${REVIEW_PROMPT}\n\nReturn ONLY the JSON object, without commentary or Markdown.\nContext:\n${JSON.stringify({ product: context.product, sourceReviews: context.sourceReviews, priorSamples: context.priorSamples, reviewPlan: plans, count: plans.length, repair })}`;
      let isFinished = false;
      let lastPhase: ReviewTextPhase | undefined;
      let statusRequest = Promise.resolve();
      const timer = setInterval(() => {
        if (isFinished) return;
        statusRequest = statusRequest.then(async () => {
          if (isFinished) return;
          try {
            const response = await fetch(new URL(`/api/review-images/text/${id}`, options.baseUrl), {
              headers: { "X-Bridge-Token": options.token }, signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
            });
            const snapshot = z.object({ status: z.string() }).parse(await response.json());
            const phase = z.enum(['waiting_response', 'reading_response', 'sending_response']).safeParse(snapshot.status === 'running' ? 'waiting_response' : snapshot.status);
            if (!isFinished && phase.success && phase.data !== lastPhase) { lastPhase = phase.data; await progress("running", phase.data); }
          } catch { /* The main request reports transport failures; status is observational. */ }
        });
      }, 2000);
      let response: Response;
      try { response = await fetch(new URL("/api/review-images/text", options.baseUrl), {
        method: "POST", headers: { "Content-Type": "application/json", "X-Bridge-Token": options.token },
        body: JSON.stringify({ prompt, session: id }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]),
      }); } finally { isFinished = true; clearInterval(timer); await statusRequest; }
      if (!response.ok) throw new Error("REVIEW_BRIDGE_FAILED");
      const body = z.object({ answer: z.string().max(200_000) }).parse(await response.json());
      await progress("validating");
      try { return parseChatGptSamples(body.answer); } catch { return []; }
    });
  };
}
