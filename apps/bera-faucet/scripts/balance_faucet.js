const {ethers, JsonRpcProvider} = require("ethers");
const fs = require('fs');
require("dotenv").config();

const { RPC_PROVIDER, USER_PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

async function balanceFaucet() {
    const provider = new JsonRpcProvider(RPC_PROVIDER);
    const wallet = new ethers.Wallet(USER_PRIVATE_KEY, provider);
    const signer = wallet.connect(provider);

    const contract = require("../artifacts/contracts/Faucet.sol/Faucet.json");

    const faucetContract = new ethers.Contract(CONTRACT_ADDRESS, contract.abi, wallet);
    const balance = await faucetContract.getBalance();
    
    console.log('Balance:', ethers.formatEther(balance), "token");
}

// npx hardhat run scripts/balance_faucet.js
balanceFaucet().catch(console.error);
