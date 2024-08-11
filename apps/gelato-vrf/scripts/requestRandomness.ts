import { ethers } from "hardhat";
import { SimpleVRFContract__factory } from "../typechain-types";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const contractAddress = "0x3E183d1C8fcfdb080e3107f400786f6FA6f30810";
  const PRIVATE_KEY = process.env.PRIVATE_KEY;

  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is not set");
  }

  // Setup provider
  const provider = ethers.provider;

  // Create a signer from the private key
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  // Connect to the contract using the signer
  const vrfContract = SimpleVRFContract__factory.connect(
    contractAddress,
    signer
  );

  // Request randomness
  const data = ethers.encodeBytes32String("test data"); // Use formatBytes32String instead of encodeBytes32String
  console.log(`Requesting randomness with data: ${data}`);
  const tx = await vrfContract.requestRandomness(data, { gasLimit: 1000000 });
  console.log(`Transaction hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
