import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
  PYTH_ENDPOINT: process.env.PYTH_ENDPOINT || "https://hermes.pyth.network",
  PRICE_ID: process.env.PRICE_ID || "",
  USDC_PRICE_ID:
    process.env.USDC_PRICE_ID ||
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  DATA_INTERVAL: parseFloat(process.env.DATA_INTERVAL || "5"),
  BOLLINGER_PERIOD: parseFloat(process.env.BOLLINGER_PERIOD || "20"),
  BOLLINGER_MULTIPLIER: parseFloat(process.env.BOLLINGER_MULTIPLIER || "2"),
  TRADING_CONTRACT_ADDRESS: process.env.TRADING_CONTRACT_ADDRESS || "",
  PRIVATE_KEY: process.env.PRIVATE_KEY || "",
  RPC_PROVIDER: process.env.RPC_PROVIDER || "",
};
