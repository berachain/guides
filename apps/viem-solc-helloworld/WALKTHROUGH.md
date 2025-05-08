# Deployment Script Walkthrough

This document provides a detailed explanation of the deployment script's functionality. It assumes you have already completed the setup and installation steps from the main README.

## Script Overview

The deployment script (`scripts/deploy.ts`) demonstrates how to compile and deploy a Solidity contract using Viem and Solc. Here's a step-by-step breakdown:

### 1. Contract Compilation

```typescript
// Read and compile the contract
const baseContractPath = path.join(__dirname, `../contracts/`, `${CONTRACT_NAME}.sol`);
const content = await fs.readFileSync(baseContractPath).toString();

const input = {
  language: "Solidity",
  sources: {
    baseContractPath: {
      content,
    },
  },
  settings: {
    outputSelection: {
      "*": {
        "*": ["*"],
      },
    },
  },
};

const output = solc.compile(JSON.stringify(input));
const contract = JSON.parse(output);
const contractBytecode = contract.contracts.baseContractPath[CONTRACT_NAME].evm.bytecode.object;
const contractABI = contract.contracts.baseContractPath[CONTRACT_NAME].abi;
```

This section:
- Reads the Solidity contract file
- Configures the Solc compiler input
- Compiles the contract and extracts the bytecode and ABI

### 2. Account Setup

```typescript
const privateKey = process.env.WALLET_PRIVATE_KEY as `0x${string}`;
if (!privateKey) {
  throw new Error("WALLET_PRIVATE_KEY not found in environment");
}
const account = privateKeyToAccount(privateKey);

// Create clients using berachain-config utilities
const publicClient = createBerachainPublicClient(berachainBepolia);
const walletClient = createBerachainWalletClient(privateKey, berachainBepolia);
```

This section:
- Loads the private key from environment variables
- Creates an account from the private key
- Sets up Viem clients using berachain-config utilities

### 3. Gas Estimation

```typescript
const encodedData = encodeAbiParameters(
  [{ name: "_greeting", type: "string" }],
  [INITIAL_GREETING],
);

const gasEstimate = await publicClient.estimateGas({
  account: account.address,
  data: `0x${contractBytecode}${encodedData.slice(2)}` as `0x${string}`,
});
```

This section:
- Encodes the constructor arguments
- Estimates the gas needed for deployment

### 4. Contract Deployment

```typescript
const hash = await walletClient.deployContract({
  abi: contractABI,
  bytecode: `0x${contractBytecode}` as `0x${string}`,
  args: [INITIAL_GREETING],
  account: account,
  chain: berachainBepolia,
});
```

This section:
- Deploys the contract with constructor arguments
- Uses the berachain-config utilities for chain-specific configuration

### 5. Deployment Verification

```typescript
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`${CONTRACT_NAME} deployed to ${receipt?.contractAddress}`);
```

This section:
- Waits for the transaction to be mined
- Retrieves the deployed contract address

## Example Output

```
Deploy Script
========================================================
Contract compiled successfully
Using account: 0xAe9CcC99A663239648Fc2fA4bbB8BCbf97A7c8cB
Clients configured successfully
{ gasEstimate: 491304n }
{
  hash: '0x9952c59ff267124c4d2d25e10cbf8128a0b5235a07bf8c6a516c0a8f3cf55a67'
}
HelloWorld deployed to 0x9bc6500ecb51d3471e605b6c203a1ad6c6455798
```

## Understanding the Output

1. **Contract Compilation**: Confirms successful compilation of the Solidity contract
2. **Account Setup**: Shows the account address being used for deployment
3. **Gas Estimation**: Shows the estimated gas needed (491,304 units)
4. **Transaction Hash**: The unique identifier for the deployment transaction
5. **Contract Address**: The address where the contract is deployed

## Common Issues and Solutions

1. **Chain ID Mismatch**
   - Error: "The current chain of the wallet (id: 80085) does not match the target chain (id: 80069)"
   - Solution: Ensure you're using the correct chain ID (80069 for Bepolia)

2. **RPC Method Support**
   - Error: "this request method is not supported"
   - Solution: The script uses `eth_sendTransaction` which is supported by Berachain

3. **Gas Estimation**
   - If gas estimation fails, you can manually set a gas limit
   - The current estimate of ~491,000 units is typical for this contract 