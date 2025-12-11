// Standalone payment-gated endpoint - works with any server framework
/// <reference lib="DOM" />

import { createThirdwebClient } from "thirdweb";
import { facilitator, settlePayment } from "thirdweb/x402";
import { defineChain } from "thirdweb/chains";
import * as dotenv from "dotenv";

const berachainBepolia = defineChain({
  id: 80069,
  name: "Berachain Bepolia",
  nativeCurrency: {
    name: "BERA",
    symbol: "BERA",
    decimals: 18,
  },
  rpc: "https://bepolia.rpc.berachain.com",
});

dotenv.config();

const client = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY || "",
});

const thirdwebX402Facilitator = facilitator({
  client,
  serverWalletAddress: process.env.SERVER_WALLET_ADDRESS || "",
});

export async function handlePaymentGatedRequest(
  request: Request,
  price: string = "$0.01"
): Promise<Response> {
  try {
    const paymentData = request.headers.get("x-payment");
    const resourceUrl = new URL(request.url).toString();
    const method = request.method;

    if (!paymentData) {
      return new Response(
        JSON.stringify({
          error: "Payment Required",
          message: "This endpoint requires payment",
          price,
          network: {
            chainId: berachainBepolia.id,
            name: berachainBepolia.name,
            rpcUrl: (berachainBepolia as any).rpc || "https://bepolia.rpc.berachain.com",
          },
          paymentInstructions: {
            token: "Any ERC-20 token on Berachain (supports ERC-2612 permit or ERC-3009)",
            amount: price,
          },
        }),
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const result = await settlePayment({
      resourceUrl,
      method,
      paymentData,
      payTo: process.env.SERVER_WALLET_ADDRESS || "",
      network: berachainBepolia,
      price,
      facilitator: thirdwebX402Facilitator,
    });

    if (result.status !== 200) {
      return new Response(
        JSON.stringify({
          error: "Payment Failed",
          message: result.responseBody,
        }),
        {
          status: result.status,
          headers: result.responseHeaders || {
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment successful",
        paymentInfo: {
          transactionHash: result.paymentReceipt.transaction,
          success: result.paymentReceipt.success,
          network: result.paymentReceipt.network,
          payer: result.paymentReceipt.payer,
        },
        data: {
          content: "Premium content or API result",
          timestamp: new Date().toISOString(),
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error handling payment-gated request:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}

// Usage in Next.js:
// export async function GET(request: Request) {
//   return handlePaymentGatedRequest(request, "$0.01");
// }

// Usage in Express:
// app.get("/api/premium", async (req, res) => {
//   const request = new Request(`http://localhost:3000${req.originalUrl}`, {
//     method: req.method,
//     headers: req.headers as HeadersInit,
//   });
//   const response = await handlePaymentGatedRequest(request, "$0.01");
//   const data = await response.json();
//   res.status(response.status).json(data);
// });

export { client, thirdwebX402Facilitator };
