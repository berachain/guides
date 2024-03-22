/** @type import('hardhat/config').HardhatUserConfig */

require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { RPC_PROVIDER, OWNER_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: "0.8.24",
  networks: {
    testnet: {
      url: RPC_PROVIDER,
      accounts: [OWNER_PRIVATE_KEY]
    },
  },
};
