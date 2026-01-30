// Main entry point for thirdweb x402 Berachain guide

export { makePaidApiCall } from "./client/basic-payment";
export { handlePaymentGatedRequest, client, thirdwebX402Facilitator } from "./server/basic-endpoint";
export { x402PaymentMiddleware } from "./server/express-middleware";
export { app as expressApp } from "./server/express-server";
export { getFacilitator, getTestnetFacilitator, getMainnetFacilitator, setupFacilitator } from "./facilitator/setup";
