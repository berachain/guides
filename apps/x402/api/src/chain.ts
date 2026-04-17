import { defineChain as defineThirdwebChain } from "thirdweb/chains";
import { defineChain as defineViemChain } from "viem";
import { env } from "./env";

export const viemChain = defineViemChain({
  id: env.CHAIN_ID,
  name: env.CHAIN_NAME,
  nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
  rpcUrls: {
    default: { http: [env.RPC_URL] },
    public: { http: [env.RPC_URL] },
  },
});

export const thirdwebChain = defineThirdwebChain({
  id: env.CHAIN_ID,
  name: env.CHAIN_NAME,
  rpc: env.RPC_URL,
  nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
});
