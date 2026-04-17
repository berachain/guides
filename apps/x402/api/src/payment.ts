import type { MiddlewareHandler } from "hono";
import { createThirdwebClient } from "thirdweb";
import { facilitator, settlePayment } from "thirdweb/x402";
import { parseUnits } from "viem";
import { thirdwebChain } from "./chain";
import { env } from "./env";

const client = createThirdwebClient({ secretKey: env.THIRDWEB_SECRET_KEY });

const thirdwebFacilitator = facilitator({
  client,
  serverWalletAddress: env.THIRDWEB_SERVER_WALLET_ADDRESS,
});

const priceAmount = parseUnits(env.HONEY_AMOUNT, env.HONEY_DECIMALS).toString();

export function requirePayment(description: string): MiddlewareHandler {
  return async (c, next) => {
    const paymentData =
      c.req.header("x-payment") ?? c.req.header("payment-signature") ?? null;

    let result: Awaited<ReturnType<typeof settlePayment>>;
    try {
      result = await settlePayment({
        resourceUrl: c.req.url,
        method: c.req.method,
        paymentData,
        payTo: env.PAY_TO_ADDRESS,
        network: thirdwebChain,
        price: {
          amount: priceAmount,
          asset: {
            address: env.HONEY_CONTRACT_ADDRESS,
            decimals: env.HONEY_DECIMALS,
          },
        },
        facilitator: thirdwebFacilitator,
        routeConfig: {
          description,
          mimeType: "application/json",
          maxTimeoutSeconds: 60 * 60,
        },
      });
    } catch (err) {
      console.error("[x402] facilitator error:", err);
      const message =
        err instanceof Error ? err.message : "facilitator request failed";
      return c.json(
        { error: "payment facilitator unavailable", detail: message },
        502,
      );
    }

    if (result.status !== 200) {
      for (const [key, value] of Object.entries(result.responseHeaders ?? {})) {
        c.header(key, value);
      }
      const body = mirrorPaymentRequiredBody(
        result.responseBody,
        result.responseHeaders,
      );
      return c.json(body, result.status);
    }

    for (const [key, value] of Object.entries(result.responseHeaders ?? {})) {
      c.header(key, value);
    }

    await next();
  };
}

function mirrorPaymentRequiredBody(
  body: unknown,
  headers: Record<string, string> | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : {};

  // x402 v2 stores the payment requirements (accepts[], resource, etc.) in the
  // PAYMENT-REQUIRED header as base64-encoded JSON and leaves the body empty.
  // Decode it into the body so curl users and demo UIs can read it directly
  // without pulling the header manually.
  const encoded =
    headers?.["PAYMENT-REQUIRED"] ?? headers?.["payment-required"];
  if (!encoded) return base;

  if ("accepts" in base) return base;

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    return { ...decoded, ...base };
  } catch (err) {
    console.warn("[x402] failed to decode PAYMENT-REQUIRED header:", err);
    return base;
  }
}
