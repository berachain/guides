import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";

// Process Env Variables
import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "/.env" });

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts: string[] = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: "0.8.19",

  namedAccounts: {
    deployer: {
      default: 0,
    },
  },

  defaultNetwork: "hardhat",

  networks: {
    hardhat: {
      forking: {
        url: `https://rpc.arb-blueberry.gelato.digital`,
        // blockNumber: 80000,
      },
    },

    // Shared Testnet
    blueberry: {
      accounts,
      chainId: 88153591557,
      url: `https://rpc.arb-blueberry.gelato.digital`,
    },
    raspberry: {
      accounts,
      chainId: 123420111,
      url: `https://rpc.opcelestia-raspberry.gelato.digital`,
    },
    blackberry: {
      accounts,
      chainId: 94204209,
      url: `https://rpc.polygon-blackberry.gelato.digital`,
    },
    blastSepolia: {
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 2131256,
      url: `https://sepolia.blast.io`,
    },
    ethsepolia: {
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
      url: `https://eth-sepolia.g.alchemy.com/v2/<your-api-key>`,
    },
    berachain: {
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 80084,
      url: `https://bartio.rpc.berachain.com/`,
    },

    matic: {
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 137,
      url: `https://polygon-mainnet.g.alchemy.com/v2/<your-api-key>`,
    },
    amoy: {
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 80002,
      url: `https://polygon-amoy.g.alchemy.com/v2/<your-api-key>`,
    },
  },
  etherscan: {
    apiKey: {
      blueberry: "xxx",
      raspberry: "xxx",
      blackberry: "xxx",
      berachain: "xxx",
      polygon: "yourApiKey",
    },
    customChains: [
      {
        network: "blueberry",
        chainId: 88153591557,
        urls: {
          apiURL: "https://arb-blueberry.gelatoscout.com/api",
          browserURL: "https://arb-blueberry.gelatoscout.com",
        },
      },
      {
        network: "raspberry",
        chainId: 123420111,
        urls: {
          apiURL: "https://opcelestia-raspberry.gelatoscout.com/api",
          browserURL: "https://opcelestia-raspberry.gelatoscout.com",
        },
      },
      {
        network: "berachain",
        chainId: 80084,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/80084/etherscan/api/",
          browserURL: "https://bartio.beratrail.io/",
        },
      },
    ],
  },
};

export default config;
