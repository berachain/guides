// Imports
// ========================================================
import { ethers } from "hardhat";
import dotenv from "dotenv";

// Config
// ========================================================
dotenv.config();

// Imports
// ========================================================
async function main() {
  const walletAddress = new ethers.Wallet(`${process.env.WALLET_PRIVATE_KEY}`);
  const Contract = await ethers.getContractFactory(
    `${process.env.CONTRACT_NAME}`,
  );
  const contract = await Contract.deploy(
    `${process.env.BASE_URL}`,
    walletAddress.address,
    // Needs to be set to fix for chains
    {
      gasLimit: 10000000,
    },
  );

  await contract.waitForDeployment();

  console.log(
    `${`${process.env.CONTRACT_NAME}`} deployed to ${contract.target}`,
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
