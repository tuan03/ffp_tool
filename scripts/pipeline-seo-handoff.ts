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
