import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";

require("dotenv").config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.23",
  },
  networks: {
    // for testnet
    "berachain-artio": {
      url: "https://rpc.ankr.com/berachain_testnet",
      accounts: [process.env.WALLET_KEY as string],
      chainId: 80085,
      // gas: "auto",
      gasPrice: 10000000000,
    },
    // for local dev environment
    "berachain-local": {
      url: "http://localhost:8545",
      gasPrice: 1000000000,
    },
  },
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: {
      berachainArtio: "berachainArtio", // apiKey is not required, just set a placeholder
    },
    customChains: [
      {
        network: "berachainArtio",
        chainId: 80085,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/80085/etherscan",
          browserURL: "https://artio.beratrail.io",
        },
      },
    ],
  },
};

export default config;
