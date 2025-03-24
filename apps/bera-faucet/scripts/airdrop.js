const {ethers, JsonRpcProvider} = require("ethers");
const fs = require('fs');
require("dotenv").config();

const { RPC_PROVIDER, OWNER_PRIVATE_KEY, USER_PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

async function airdrop() {
    const privateKey = OWNER_PRIVATE_KEY
     // Sepolia testnet
    const provider = new JsonRpcProvider(RPC_PROVIDER);
    const wallet = new ethers.Wallet(privateKey, provider);
    const userWallet = new ethers.Wallet(USER_PRIVATE_KEY, provider);

    const contract = require("../artifacts/contracts/Faucet.sol/Faucet.json");

    console.log("airdrop to:", userWallet.address);
    console.log("before balance:", ethers.formatEther(await provider.getBalance(userWallet.address)));

    const faucetContract = new ethers.Contract(CONTRACT_ADDRESS, contract.abi, wallet);
    const tx = await faucetContract.airdrop(userWallet.address, ethers.parseEther("0.01"));
    console.log('Transaction:', tx);

    await sleep(3000)

    console.log("after balance:", ethers.formatEther(await provider.getBalance(userWallet.address)));
}

function sleep(time){
    return new Promise((resolve) => setTimeout(resolve, time));
}

// npx hardhat run scripts/airdrop.js
airdrop().catch(console.error);
