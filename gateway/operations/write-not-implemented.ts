import { GatewayError } from "../errors";

export async function executeWriteNotImplemented(operation: string): Promise<never> {
  throw new GatewayError(
    `Write operation '${operation}' is not implemented in Phase 3 gateway`,
    "NOT_IMPLEMENTED",
    501,
  );
}
