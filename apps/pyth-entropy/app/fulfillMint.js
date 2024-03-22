const { Web3 } = require("web3");
const EntropyNFTAbi = require("../out/EntropyNFT.sol/EntropyNFT.json");
const fs = require("fs").promises;
require("dotenv").config({ path: "../.env" });

async function fulfillMint() {
  // Load variables from the JSON file
  const { userRandomNumber, sequenceNumber } = JSON.parse(
    await fs.readFile("mintData.json")
  );

  const web3 = new Web3(process.env["RPC_URL"]);
  const { address } = web3.eth.accounts.wallet.add(
    process.env["PRIVATE_KEY"]
  )[0];

  const entropyNFTContract = new web3.eth.Contract(
    EntropyNFTAbi.abi,
    process.env["ENTROPY_NFT_ADDRESS"]
  );

  // Step 3: fetch provider random number commitment
  const providerUri =
    "https://fortuna-staging.dourolabs.app/v1/chains/berachain-testnet/revelations";
  console.log("Fetching provider revelation...");
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

fulfillMint();
