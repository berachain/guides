// Imports
// ========================================================
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import dotenv from "dotenv";

// Load Environment Variables
// ========================================================
dotenv.config();

const chainId = Number(process.env.CHAIN_ID ?? 80069);
const rpcUrl = process.env.RPC_URL ?? "https://bepolia.rpc.berachain.com/";

// Main Hardhat Config
// ========================================================
const config = defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: "0.8.19",
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 1337,
    },
    // NOTE: hardhat viem currently doesn't yet support this method for custom chains through Hardhat config ↴
    berachainBepolia: {
      type: "http",
      chainType: "l1",
      chainId,
      url: rpcUrl,
      accounts: process.env.WALLET_PRIVATE_KEY
        ? [`${process.env.WALLET_PRIVATE_KEY}`]
        : [],
    },
  },
  // For Contract Verification
  etherscan: {
    apiKey: `${process.env.BLOCK_EXPLORER_API_KEY}`,
    customChains: [
      {
        network: "Berachain Testnet",
        chainId,
        urls: {
          apiURL: `${process.env.BLOCK_EXPLORER_API_URL}`,
          browserURL: `${process.env.BLOCK_EXPLORER_URL}`,
        },
      },
    ],
  },
});

// Exports
// ========================================================
export default config;
