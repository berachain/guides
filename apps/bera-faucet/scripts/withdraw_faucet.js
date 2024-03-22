const {ethers, JsonRpcProvider} = require("ethers");
const fs = require('fs');
require("dotenv").config();

const { RPC_PROVIDER, OWNER_PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

async function withdrawFaucet() {
    const privateKey = OWNER_PRIVATE_KEY
     // Sepolia testnet
    const provider = new JsonRpcProvider(RPC_PROVIDER);
    const wallet = new ethers.Wallet(privateKey, provider);
    const signer = wallet.connect(provider);

    const contract = require("../artifacts/contracts/Faucet.sol/Faucet.json");

    const faucetContract = new ethers.Contract(CONTRACT_ADDRESS, contract.abi, wallet);
    const tx = await faucetContract.withdraw();
    
    console.log('Transaction:', tx);
}

// npx hardhat run scripts/withdraw_faucet.js
withdrawFaucet().catch(console.error);
