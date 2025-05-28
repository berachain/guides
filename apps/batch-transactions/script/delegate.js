const { createPublicClient, createWalletClient, http, parseEther, encodeFunctionData, encodeDeployData } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { berachainBepolia } = require('viem/chains');
const { keccak256 } = require('viem');

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
require('dotenv').config();

// Contract addresses
const BATCH_TX_ADDRESS = '0x30EE632AA0033BAEca62EC0A2e4c9E8BA60B2F49';

// ABI for the BatchTransaction contract
const batchTxABI = [
  {
    "inputs": [
      {
        "components": [
          { "name": "target", "type": "address" },
          { "name": "value", "type": "uint256" },
          { "name": "data", "type": "bytes" }
        ],
        "name": "transactions",
        "type": "tuple[]"
      }
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "bytecode", "type": "bytes" },
      { "name": "salt", "type": "bytes32" }
    ],
    "name": "deployCreate2",
    "outputs": [{ "name": "deployed", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// ABI for the ERC20 token
const erc20ABI = [
  {
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "transfer",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Function to compute CREATE2 address
function computeCreate2Address(deployer, salt, bytecodeHash) {
  const packed = new Uint8Array(1 + 20 + 32 + 32);
  packed[0] = 0xff; // First byte is 0xff
  packed.set(deployer.slice(2).match(/.{1,2}/g).map(byte => parseInt(byte, 16)), 1); // Deployer address
  packed.set(salt.slice(2).match(/.{1,2}/g).map(byte => parseInt(byte, 16)), 21); // Salt
  packed.set(bytecodeHash.slice(2).match(/.{1,2}/g).map(byte => parseInt(byte, 16)), 53); // Bytecode hash
  
  const hash = keccak256(packed);
  return `0x${hash.slice(26)}`; // Take last 20 bytes for address
}

async function main() {
  try {
    console.log(chalk.blue('🚀 Starting batch transaction execution...'));

    // Create clients
    const publicClient = createPublicClient({
      chain: berachainBepolia,
      transport: http('https://bepolia.rpc.berachain.com')
    });

    // Ensure private key is properly formatted
    const privateKey = process.env.PRIVATE_KEY.startsWith('0x') 
      ? process.env.PRIVATE_KEY 
      : `0x${process.env.PRIVATE_KEY}`;

    console.log(chalk.gray('Using private key:', privateKey));
    
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: berachainBepolia,
      transport: http('https://bepolia.rpc.berachain.com')
    });

    // Get the current nonce for authorization
    const nonce = await publicClient.getTransactionCount({
      address: account.address
    });

    console.log(chalk.blue('🔐 Preparing authorization...'));
    
    // Prepare and sign the authorization
    const authorization = await walletClient.prepareAuthorization({
      contractAddress: BATCH_TX_ADDRESS,
      nonce: BigInt(nonce)
    });

    const signedAuthorization = await walletClient.signAuthorization(authorization);
    console.log(chalk.green('✅ Authorization signed'));

    console.log(chalk.blue('📝 Reading contract artifact...'));
    // Read the artifact file
    const artifactPath = path.join(__dirname, '../bytecode/UrsaToken.json');
    const { bytecode, abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    // Encode the constructor arguments
    const deployData = encodeDeployData({
      abi,
      bytecode: `0x${bytecode}`,
      args: [] // No constructor arguments for UrsaToken
    });

    const salt = '0x0000000000000000000000000000000000000000000000000000000000000001';
    
    // Simulate deployCreate2 to get the predicted address
    console.log(chalk.blue('🔍 Simulating contract deployment...'));
    const predictedTokenAddress = await publicClient.simulateContract({
      address: BATCH_TX_ADDRESS,
      abi: batchTxABI,
      functionName: 'deployCreate2',
      args: [deployData, salt],
      account: account.address
    }).then(result => result.result).catch(error => {
      console.log(chalk.yellow('⚠️ Could not simulate deployment, will use deployment transaction to get address'));
      return null;
    });

    if (predictedTokenAddress) {
      console.log(chalk.green('Token will be deployed at:', predictedTokenAddress));
    }

    // Prepare the batch of transactions
    const transactions = [
      // Deploy token using CREATE2
      {
        target: BATCH_TX_ADDRESS,
        value: 0n,
        data: encodeFunctionData({
          abi: batchTxABI,
          functionName: 'deployCreate2',
          args: [deployData, salt]
        })
      }
    ];

    // Add token transfers to the batch
    const boardMembers = [
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
    ];
    const BOARD_MEMBER_SHARE = parseEther('1000');

    // Add transfer transactions using the predicted address
    for (const member of boardMembers) {
      transactions.push({
        target: predictedTokenAddress || BATCH_TX_ADDRESS, // Use predicted address or fallback to batch contract
        value: 0n,
        data: encodeFunctionData({
          abi: erc20ABI,
          functionName: 'transfer',
          args: [member, BOARD_MEMBER_SHARE]
        })
      });
    }

    console.log(chalk.blue('📦 Preparing batch transaction...'));
    console.log(chalk.gray(`Total transactions in batch: ${transactions.length}`));

    // Execute the batch transaction with authorization
    console.log(chalk.yellow('⏳ Sending transaction...'));
    const hash = await walletClient.writeContract({
      address: BATCH_TX_ADDRESS,
      abi: batchTxABI,
      functionName: 'execute',
      args: [transactions.map(tx => ({
        target: tx.target,
        value: tx.value,
        data: tx.data
      }))],
      account: account.address,
      chain: berachainBepolia,
      authorization: signedAuthorization
    });

    console.log(chalk.green('✅ Transaction sent!'));
    console.log(chalk.gray('Transaction hash:', hash));

    // Wait for the transaction to be mined
    console.log(chalk.yellow('⏳ Waiting for transaction confirmation...'));
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(chalk.green('✨ Transaction successful!'));
    console.log(chalk.gray('Gas used:', receipt.gasUsed.toString()));

    // If we couldn't predict the address, we can get it from the transaction receipt
    if (!predictedTokenAddress) {
      const deployedAddress = receipt.logs[0].address;
      console.log(chalk.green('Token deployed at:', deployedAddress));
    }
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    if (error.details) {
      console.error(chalk.red('Details:'), error.details);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(chalk.red('❌ Fatal error:'), error);
  process.exitCode = 1;
}); 