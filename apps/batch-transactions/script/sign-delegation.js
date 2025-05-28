const { createPublicClient, createWalletClient, http, encodeFunctionData } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bepolia } = require('./chains');
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
  }
];

async function main() {
  // Create clients
  const publicClient = createPublicClient({
    chain: bepolia,
    transport: http(process.env.RPC_URL)
  });

  // Ensure private key is properly formatted
  const privateKey = process.env.PRIVATE_KEY.startsWith('0x') 
    ? process.env.PRIVATE_KEY 
    : `0x${process.env.PRIVATE_KEY}`;

  console.log('Using private key:', privateKey);
  
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: bepolia,
    transport: http(process.env.RPC_URL)
  });

  // Get the current nonce
  const nonce = await publicClient.getTransactionCount({
    address: account.address
  });

  console.log('Current nonce:', nonce);
  console.log('Account address:', account.address);

  // Prepare the authorization using wallet client
  const authorization = await walletClient.prepareAuthorization({
    contractAddress: BATCH_TX_ADDRESS,
    nonce: BigInt(nonce)
  });

  console.log('Prepared authorization:', authorization);

  // Sign the authorization
  const signedAuthorization = await walletClient.signAuthorization(authorization);

  console.log('Signed authorization:', signedAuthorization);

  // Example of how to use the authorization in a transaction
  const transactions = [
    {
      target: BATCH_TX_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: batchTxABI,
        functionName: 'execute',
        args: [[]] // Empty transactions array for example
      })
    }
  ];

  // The transaction would need to include the authorization in its data
  // This is just an example of how the transaction would look
  console.log('Example transaction with authorization:', {
    from: account.address,
    to: BATCH_TX_ADDRESS,
    data: transactions[0].data,
    nonce,
    authorization: signedAuthorization
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 