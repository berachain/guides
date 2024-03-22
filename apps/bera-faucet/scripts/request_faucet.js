const {ethers, JsonRpcProvider} = require("ethers");
const fs = require('fs');
require("dotenv").config();

const { RPC_PROVIDER, USER_PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

async function requestFaucet() {
     // Sepolia testnet
    const provider = new JsonRpcProvider(RPC_PROVIDER);
    const wallet = new ethers.Wallet(USER_PRIVATE_KEY, provider);
    const signer = wallet.connect(provider);

    const contract = require("../artifacts/contracts/Faucet.sol/Faucet.json");

    const faucetContract = new ethers.Contract(CONTRACT_ADDRESS, contract.abi, wallet);
    const tx = await faucetContract.request();
    
    console.log('Transaction:', tx);
}

// npx hardhat run scripts/request_faucet.js
requestFaucet().catch(console.error);
