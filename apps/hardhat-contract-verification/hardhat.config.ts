import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import dotenv from "dotenv";

dotenv.config();

const chainId = 80069;
const rpcUrl = process.env.RPC_URL ?? "https://bepolia.rpc.berachain.com";

const config = defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    version: "0.8.30",
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // for testnet
    "berachain-bepolia": {
      type: "http",
      chainType: "l1",
      url: rpcUrl,
      accounts: process.env.WALLET_KEY ? [process.env.WALLET_KEY] : [],
      chainId,
      // gas: "auto",
      gasPrice: 10000000000,
    },
    // for local dev environment
    "berachain-local": {
      type: "http",
      chainType: "l1",
      url: "http://localhost:8545",
      gasPrice: 1000000000,
    },
  },
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: {
      "berachain-bepolia": "verifyContract", // apiKey is not required, just set a placeholder
    },
    customChains: [
      {
        network: "berachain-bepolia",
        chainId,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/80069/etherscan",
          browserURL: "https://bepolia.beratrail.io",
        },
      },
    ],
  },
});

export default config;
