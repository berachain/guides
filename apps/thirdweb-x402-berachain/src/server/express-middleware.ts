// Express middleware for accepting x402 payments

import { Request, Response, NextFunction } from "express";
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

// Middleware that checks for payment and settles it on-chain
function x402PaymentMiddleware(price: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentData = req.headers["x-payment"] as string | undefined;
      const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

      if (!paymentData) {
        return res.status(402).json({
          error: "Payment Required",
          message: "This endpoint requires payment",
          price,
          network: {
            chainId: berachainBepolia.id,
            name: berachainBepolia.name,
          },
          paymentInstructions: {
            token: "Any ERC-20 token on Berachain",
            amount: price,
          },
        });
      }

      const result = await settlePayment({
        resourceUrl,
        method: req.method,
        paymentData,
        payTo: process.env.SERVER_WALLET_ADDRESS || "",
        network: berachainBepolia,
        price,
        facilitator: thirdwebX402Facilitator,
      });

      if (result.status !== 200) {
        return res.status(result.status).json({
          error: "Payment Failed",
          message: result.responseBody,
        });
      }

      (req as any).paymentInfo = {
        transactionHash: result.paymentReceipt.transaction,
        success: result.paymentReceipt.success,
        network: result.paymentReceipt.network,
        payer: result.paymentReceipt.payer,
      };

      next();
    } catch (error) {
      console.error("Payment middleware error:", error);
      return res.status(500).json({
        error: "Payment Processing Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}

export { x402PaymentMiddleware };
