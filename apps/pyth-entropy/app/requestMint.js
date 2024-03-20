const { Web3 } = require("web3");
const EntropyNFTAbi = require("../out/EntropyNFT.sol/EntropyNFT.json");
const EntropyAbi = require("@pythnetwork/entropy-sdk-solidity/abis/IEntropy.json");
const fs = require("fs").promises;
require("dotenv").config({ path: "../.env" });

async function requestMint() {
  // Step 1: initialize wallet & web3 contracts
  const web3 = new Web3(process.env["RPC_URL"]);
  const { address } = web3.eth.accounts.wallet.add(
    process.env["PRIVATE_KEY"]
  )[0];

  web3.eth.defaultBlock = "finalized";

  const entropyNFTContract = new web3.eth.Contract(
    EntropyNFTAbi.abi,
    process.env["ENTROPY_NFT_ADDRESS"]
  );

  const entropyContract = new web3.eth.Contract(
    EntropyAbi,
    process.env["ENTROPY_ADDRESS"]
  );

  // Step 2: generate user random number, request mint
  console.log("Generating user random number and commitment...");
  const userRandomNumber = web3.utils.randomHex(32);
  const userCommitment = web3.utils.keccak256(userRandomNumber);
  console.log(`User Random Number: ${userRandomNumber}`);
  console.log(`User Commitment: ${userCommitment}`);

  console.log("Fetching request fee...");
  const fee = await entropyContract.methods
    .getFee(process.env["PROVIDER_ADDRESS"])
    .call();
  console.log(`Request Fee: ${fee}`);

  console.log("Requesting NFT mint...");
  const requestReceipt = await entropyNFTContract.methods
    .requestMint(userCommitment)
    .send({ value: fee, from: address });
  console.log(`Request Transaction Hash: ${requestReceipt.transactionHash}`);

  const sequenceNumber =
    requestReceipt.events.NumberRequested.returnValues.sequenceNumber;
  console.log(`Sequence Number: ${sequenceNumber}`);

  // Save variables to a JSON file
  const data = {
    userRandomNumber,
    sequenceNumber: Number(sequenceNumber),
  };
  await fs.writeFile("mintData.json", JSON.stringify(data, null, 2));

  console.log("Mint data saved to mintData.json");
}

requestMint();
