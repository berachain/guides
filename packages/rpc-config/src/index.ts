import { Chain, defineChain } from "viem";

/**
 * Berachain Mainnet Configuration
 * Chain ID: 80094
 */
export const berachainMainnet = defineChain({
  id: 80094,
  name: "Berachain",
  network: "berachain",
  nativeCurrency: {
    decimals: 18,
    name: "BERA",
    symbol: "BERA",
  },
  rpcUrls: {
    default: { http: ["https://rpc.berachain.com"] },
    public: { http: ["https://rpc.berachain.com"] },
  },
  blockExplorers: {
    default: { name: "BeraScan", url: "https://berascan.com" },
    beratrail: { name: "BeraTrail", url: "https://beratrail.io" },
  },
  testnet: false,
});

/**
 * Berachain Bepolia Testnet Configuration
 * Chain ID: 80069
 */
export const berachainBepolia = defineChain({
  id: 80069,
  name: "Berachain Bepolia",
  network: "berachain-bepolia",
  nativeCurrency: {
    decimals: 18,
    name: "BERA",
    symbol: "BERA",
  },
  rpcUrls: {
    default: { http: ["https://bepolia.rpc.berachain.com"] },
    public: { http: ["https://bepolia.rpc.berachain.com"] },
  },
  blockExplorers: {
    default: { name: "BeraTrail", url: "https://bepolia.beratrail.io" },
  },
  testnet: true,
});

/**
 * Get chain configuration by chain ID
 */
export function getChainById(chainId: number): Chain {
  switch (chainId) {
    case 80094:
      return berachainMainnet;
    case 80069:
      return berachainBepolia;
    default:
      throw new Error(`Chain ID ${chainId} not supported`);
  }
}

/**
 * Get chain configuration by network name
 */
export function getChainByName(network: string): Chain {
  switch (network.toLowerCase()) {
    case "berachain":
    case "mainnet":
      return berachainMainnet;
    case "bepolia":
    case "testnet":
      return berachainBepolia;
    default:
      throw new Error(`Network ${network} not supported`);
  }
}

export type { Chain };
