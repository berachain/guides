// Complete Express server with x402 payment support

import express from "express";
import { x402PaymentMiddleware } from "./express-middleware";

const app = express();
app.use(express.json());
app.get(
  "/api/premium-content",
  x402PaymentMiddleware("$0.01"),
  (req: express.Request, res: express.Response) => {
    const paymentInfo = (req as any).paymentInfo;
    
    res.json({
      message: "Premium content accessed successfully",
      paymentInfo: {
        transactionHash: paymentInfo.transactionHash,
        success: paymentInfo.success,
        network: paymentInfo.network,
        payer: paymentInfo.payer,
      },
      content: {
        title: "Premium Article",
        body: "This is premium content that requires payment to access.",
        publishedAt: new Date().toISOString(),
      },
    });
  }
);

app.post(
  "/api/process-data",
  x402PaymentMiddleware("$0.05"),
  (req: express.Request, res: express.Response) => {
    const paymentInfo = (req as any).paymentInfo;
    
    res.json({
      message: "Data processed successfully",
      paymentInfo: {
        transactionHash: paymentInfo.transactionHash,
        success: paymentInfo.success,
        network: paymentInfo.network,
        payer: paymentInfo.payer,
      },
      result: {
        processed: true,
        input: req.body,
        processedAt: new Date().toISOString(),
      },
    });
  }
);

app.get("/health", (req: express.Request, res: express.Response) => {
  res.json({
    status: "ok",
    service: "x402 Payment Server",
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`x402 Payment Server running on http://localhost:${PORT}`);
  console.log("Available endpoints:");
  console.log(`  GET  /health (free)`);
  console.log(`  GET  /api/premium-content (requires $0.01 payment)`);
  console.log(`  POST /api/process-data (requires $0.05 payment)`);
});

export { app };
