const { Web3 } = require("web3");
const EntropyNFTAbi = require("../out/EntropyNFT.sol/EntropyNFT.json");
const EntropyAbi = require("@pythnetwork/entropy-sdk-solidity/abis/IEntropy.json");
require("dotenv").config();

async function main() {
  // Step 1: initialize wallet & web3 contracts
  const web3 = new Web3(process.env["RPC_URL"]);
  const { address } = web3.eth.accounts.wallet.add(
    process.env["PRIVATE_KEY"]
  )[0];

  console.log({ address });

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

  // Step 3: fetch provider random number commitment
  const providerUri =
    "https://fortuna-staging.dourolabs.app/v1/chains/berachain-testnet/revelations";

  console.log("Fetching provider revelation, this will take a few seconds...");

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const res = await fetch(`${providerUri}/${sequenceNumber}`);
  const fortunaRevelation = await res.json();
  console.log(`Fortuna Revelation: ${JSON.stringify(fortunaRevelation)}`);

  // Step 4: submit commitments to reveal random num & mint NFT
  console.log("Fulfilling NFT mint...");
  const fulfillReceipt = await entropyNFTContract.methods
    .fulfillMint(
      sequenceNumber,
      userRandomNumber,
      "0x" + fortunaRevelation.value.data
    )
    .send({ from: address });
  console.log(`Mint Transaction Hash: ${fulfillReceipt.transactionHash}`);

  const tokenId = fulfillReceipt.events.Minted.returnValues.tokenId;
  console.log(`Minted NFT Token ID: ${tokenId}`);
}

main();
