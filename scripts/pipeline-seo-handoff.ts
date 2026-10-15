export class SeoGatewayRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(`GPT SEO gateway returned ${status}: ${message}`);
    this.name = "SeoGatewayRequestError";
    this.code = code;
    this.status = status;
  }
}

/** A concurrent enqueue is a skip only after the Coordinator verifies exact identities. */
export async function settleSeoEnqueueConflict(input: {
  readonly error: unknown;
  readonly verifyAndSkip: () => Promise<boolean>;
}): Promise<boolean> {
  if (!(input.error instanceof SeoGatewayRequestError) || input.error.code !== "ALREADY_IN_SEO_PIPELINE") {
    return false;
  }
  if (await input.verifyAndSkip()) return true;
  throw new SeoGatewayRequestError("SEO_PIPELINE_IDENTITY_CONFLICT", 409,
    "Sản phẩm đang có khóa SEO nhưng chưa xác minh được toàn bộ ASIN trùng. Kiểm tra SEO Queue trước khi xử lý lại.");
}

/** A timeout does not cancel the Gateway transaction. Recover its receipt before backing off. */
export async function recoverUncertainSeoEnqueue(input: {
  readonly error: unknown;
  readonly recover: () => Promise<boolean>;
  readonly delay: (milliseconds: number) => Promise<void>;
}): Promise<boolean> {
  const isUncertain = input.error instanceof SeoGatewayRequestError
    ? input.error.status >= 500
    : input.error instanceof Error && (input.error.name === "TimeoutError" || input.error.name === "AbortError"
      || /fetch failed|network|socket|econn|etimedout/i.test(input.error.message));
  if (!isUncertain) return false;
  for (const milliseconds of [0, 500, 1500]) {
    if (milliseconds) await input.delay(milliseconds);
    try {
      if (await input.recover()) return true;
    } catch {
      // Recovery is best-effort and bounded; the original failure still reaches failClaim.
    }
  }
  return false;
}
