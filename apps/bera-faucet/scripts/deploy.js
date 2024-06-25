// Importing necessary libraries
const { ethers } = require("hardhat");

// Main deployment function
async function main() {
  // Getting the current signer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contract with the account:", deployer.address);

  // Compiling the contract
  const FaucetContract = await ethers.getContractFactory("Faucet");

  // Deploying the contract
  const faucetContract = await FaucetContract.deploy(ethers.parseEther("0.05"));

  // console.log(faucetContract);

  console.log("Contract deployed to address:", faucetContract.target);
}

// Calling the deployment script
// npx hardhat run scripts/deploy.js
// npx hardhat run --network testnet scripts/deploy.js
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });