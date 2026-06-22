import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";
import "hardhat-deploy";

// Process Env Variables
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts: string[] = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config = defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: "0.8.30",

  namedAccounts: {
    deployer: {
      default: 0,
    },
  },

  defaultNetwork: "hardhat",

  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    berachainBepolia: {
      type: "http",
      chainType: "l1",
      accounts,
      chainId: 80069,
      url: "https://bepolia.rpc.berachain.com/",
    },
  },
  etherscan: {
    apiKey: {
      berachainBepolia: "verifyContract",
    },
    customChains: [
      {
        network: "berachainBepolia",
        chainId: 80069,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/80069/etherscan",
          browserURL: "https://bepolia.beratrail.io/",
        },
      },
    ],
  },
});

export default config;
