// Facilitator setup for settling payments on-chain

import { createThirdwebClient } from "thirdweb";
import { facilitator } from "thirdweb/x402";
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

const berachainMainnet = defineChain({
  id: 80094,
  name: "Berachain",
  nativeCurrency: {
    name: "BERA",
    symbol: "BERA",
    decimals: 18,
  },
  rpc: "https://rpc.berachain.com",
});

dotenv.config();

const client = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY || "",
});

function setupFacilitator(chainId: number = 80069) {
  const chain = chainId === 80094 ? berachainMainnet : berachainBepolia;
  
  const thirdwebX402Facilitator = facilitator({
    client,
    serverWalletAddress: process.env.SERVER_WALLET_ADDRESS || "",
  });

  console.log("Facilitator configured:");
  console.log(`  Chain: ${chain.name} (Chain ID: ${chain.id})`);
  console.log(`  Server Wallet: ${process.env.SERVER_WALLET_ADDRESS}`);
  const rpcUrl = (chain as any).rpc || "N/A";
  console.log(`  RPC URL: ${rpcUrl}`);

  return thirdwebX402Facilitator;
}

export function getTestnetFacilitator() {
  return setupFacilitator(80069);
}

export function getMainnetFacilitator() {
  return setupFacilitator(80094);
}

export function getFacilitator() {
  const chainId = parseInt(process.env.CHAIN_ID || "80069");
  return setupFacilitator(chainId);
}

if (require.main === module) {
  console.log("Setting up x402 Facilitator for Berachain\n");
  
  try {
    if (!process.env.THIRDWEB_SECRET_KEY) {
      throw new Error("THIRDWEB_SECRET_KEY is required");
    }

    if (!process.env.SERVER_WALLET_ADDRESS) {
      throw new Error("SERVER_WALLET_ADDRESS is required");
    }

    const facilitator = getFacilitator();
    
    console.log("\nFacilitator setup complete!");
    console.log("Use this facilitator instance in your server endpoints.");
    
  } catch (error) {
    console.error("Failed to setup facilitator:", error);
    process.exit(1);
  }
}

export { client, setupFacilitator };
