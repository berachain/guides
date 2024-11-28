const {ethers, JsonRpcProvider} = require("ethers");
const fs = require('fs');
require("dotenv").config();

const { RPC_PROVIDER, OWNER_PRIVATE_KEY, USER_PRIVATE_KEY,CONTRACT_ADDRESS } = process.env;

async function donateFaucet() {
     // Sepolia testnet
    const provider = new JsonRpcProvider(RPC_PROVIDER);
    const wallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
    const userWallet = new ethers.Wallet(USER_PRIVATE_KEY, provider);


    const contract = require("../artifacts/contracts/Faucet.sol/Faucet.json");

    const faucetContract = new ethers.Contract(CONTRACT_ADDRESS, contract.abi, wallet);
    const tx = await faucetContract.donate({ value: ethers.parseEther("0.1") });
    
    console.log('Transaction:', tx);
}

// npx hardhat run scripts/donate_faucet.js
donateFaucet().catch(console.error);
