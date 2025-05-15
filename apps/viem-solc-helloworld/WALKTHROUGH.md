# Deploying Your Contract on Berachain 🚀

This walkthrough explains how the deployment script works, with code snippets to help you understand each step. We'll go through the process of compiling and deploying a smart contract on Berachain.

## The Deployment Process 🛠️

### Step 1 - Contract Compilation 🔨

First, we need to compile your Solidity contract into bytecode that the blockchain can understand:

```typescript
// Read the contract file
const baseContractPath = path.join(__dirname, `../contracts/`, `${CONTRACT_NAME}.sol`);
const content = await fs.readFileSync(baseContractPath).toString();

// Configure the compiler
const input = {
  language: "Solidity",
  sources: {
    baseContractPath: { content },
  },
  settings: {
    outputSelection: {
      "*": { "*": ["*"] },
    },
  },
};

// Compile and extract bytecode and ABI
const output = solc.compile(JSON.stringify(input));
const contract = JSON.parse(output);
const contractBytecode = contract.contracts.baseContractPath[CONTRACT_NAME].evm.bytecode.object;
const contractABI = contract.contracts.baseContractPath[CONTRACT_NAME].abi;
```

The compiler takes your Solidity code and generates:
- Bytecode: The actual code that runs on the blockchain
- ABI: A description of your contract's functions and data structures

### 2. Wallet Connection 👛

Next, we set up the connection to your wallet:

```typescript
// Create account from private key
const account = privateKeyToAccount(privateKey);

// Initialize clients
const publicClient = createBerachainPublicClient(berachainBepolia);
const walletClient = createBerachainWalletClient(privateKey, berachainBepolia);
```

This step:
- Creates your account identity from your private key
- Sets up two clients:
  - `publicClient`: For reading from the blockchain
  - `walletClient`: For sending transactions

### 3. Gas Estimation ⛽

Before deploying, we need to estimate how much gas the deployment will cost:

```typescript
// Encode constructor arguments
const encodedData = encodeAbiParameters(
  [{ name: "_greeting", type: "string" }],
  [INITIAL_GREETING],
);

// Estimate gas
const gasEstimate = await publicClient.estimateGas({
  account: account.address,
  data: `0x${contractBytecode}${encodedData.slice(2)}` as `0x${string}`,
});
```

Gas is the fuel that powers your transaction. The estimate helps ensure your transaction has enough gas to complete.

### 4. Contract Deployment 🚀

Now we're ready to deploy your contract:

```typescript
// Deploy with constructor arguments
const hash = await walletClient.deployContract({
  abi: contractABI,
  bytecode: `0x${contractBytecode}` as `0x${string}`,
  args: [INITIAL_GREETING],
  account: account,
  chain: berachainBepolia,
});
```

This sends your contract to the blockchain with:
- The compiled bytecode
- The contract's ABI
- Initial constructor arguments (in this case, the greeting message)

### 5. Deployment Verification ✨

Finally, we wait for the transaction to be confirmed and get your contract's address:

```typescript
// Wait for transaction confirmation
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`${CONTRACT_NAME} deployed to ${receipt?.contractAddress}`);
```

This step ensures your contract is actually on the blockchain and gives you its address.

## Example Output 📊

When everything works, you'll see something like this:

```
🚀 Let's Deploy Your Contract!
========================================================

✓ Contract compiled successfully
📝 Using account: 0xAe9CcC99A663239648Fc2fA4bbB8BCbf97A7c8cB
✓ Clients configured successfully
⛽ Gas Estimate: 491304
🔗 Transaction Hash: 0x8e5f11a3369037b4914f683df48a4226ff97eb7253d3391d325a171dab1109d0

✅ HelloWorld deployed to 0x312090e33473e532c41abab0df07a4094ba60f8e
========================================================
```

## Common Issues and Solutions 🔧

### Compilation Errors
   - Check your Solidity code syntax
   - Verify compiler version compatibility
   - Look for missing semicolons or brackets

2. **Transaction Failures**
   - Ensure sufficient gas (check the estimate)
   - Verify your private key has enough tokens
   - Check network connectivity

3. **Deployment Timeout**
   - Network might be congested
   - Try increasing the transaction timeout
   - Verify RPC endpoint is responsive

## Next Steps 🎯

Now that your contract is deployed, you can:
- Interact with it using the contract address
- Call its functions using the ABI
- Monitor its events on the blockchain

## Need Help? 🤝

If you encounter issues:
- Check the error message for specific details
- Verify the transaction on the block explorer
- Make sure your code matches the examples above 