import { GatewayError } from "./errors";
import type { GatewayDispatcher } from "./dispatcher";
import type { GatewayRequest } from "./types";

export function createGatewayHttpHandler(dispatcher: GatewayDispatcher): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_INVALID_INPUT", message: "Method Not Allowed" },
        }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_INVALID_INPUT", message: "Malformed JSON body" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const response = await dispatcher.dispatch(body as GatewayRequest);
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      if (err instanceof GatewayError) {
        return new Response(
          JSON.stringify({
            storeId: (body as GatewayRequest)?.storeId ?? "",
            operation: (body as GatewayRequest)?.operation ?? "",
            success: false,
            error: {
              code: err.code,
              message: err.message,
              retryAfterSeconds: err.retryAfterSeconds,
            },
          }),
          {
            status: err.httpStatus,
            headers: {
              "Content-Type": "application/json",
              ...(err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : {}),
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SHOPIFY_NETWORK_ERROR", message: "Internal Gateway Error" },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
