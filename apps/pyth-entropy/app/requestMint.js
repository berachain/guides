const { Web3 } = require("web3");
const EntropyNFTAbi = require("../out/EntropyNFT.sol/EntropyNFT.json");
const EntropyAbi = require("@pythnetwork/entropy-sdk-solidity/abis/IEntropy.json");
require("dotenv").config({ path: "../.env" });

async function requestMint() {
  // Step 1: initialize wallet & web3 contracts
  const web3 = new Web3(process.env["RPC_URL"]);
  const { address } = web3.eth.accounts.wallet.add(
    process.env["PRIVATE_KEY"]
  )[0];

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
  console.log(`User Random Number: ${userRandomNumber}`);

  console.log("Fetching request fee...");
  const fee = await entropyContract.methods
    .getFee(process.env["PROVIDER_ADDRESS"])
    .call();
  console.log(`Request Fee: ${fee}`);

  console.log("Requesting NFT mint...");
  const requestReceipt = await entropyNFTContract.methods
    .requestMint(userRandomNumber)
    .send({ value: fee, from: address });
  console.log(`Request Transaction Hash: ${requestReceipt.transactionHash}`);

  const sequenceNumber =
    requestReceipt.events.NumberRequested.returnValues.sequenceNumber;
  console.log(`Sequence Number: ${sequenceNumber}`);

  // Poll for new Minted events emitted by EntropyNFT
  // Stops polling when same sequenceNumber is fulfilled 
  const intervalId = setInterval(async () => {
    currentBlock = await web3.eth.getBlockNumber();

    const events = await entropyNFTContract.getPastEvents("Minted", {
      fromBlock: currentBlock - 5n,
      toBlock: currentBlock,
    });
    
    // console.log(events)
    // Find the event with the same sequence number as the request.
    const event = events.find(
      (event) => event.returnValues.sequenceNumber === sequenceNumber
    );
    
    // If the event is found, log the result and stop polling.
    if (event !== undefined) {
      const values = events[0].returnValues
      console.log(`✅ NFT ID ${values.tokenId} minted to ${values.minter}, based on sequenceNumber ${values.sequenceNumber}`)
      clearInterval(intervalId);
    }
  }, 2000);

}

requestMint();
