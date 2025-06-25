# Gas Burner Contract

A smart contract and testing framework designed to burn a specified amount of gas for testing purposes. This is particularly useful for testing client behavior with large transactions (e.g., 8 million gas transactions that some clients like Geth may not seal while Reth does).

## Overview

This project includes:
- **Smart Contract**: `GasBurner.sol` with multiple methods to burn gas
- **Testing Scripts**: Automated scripts for single and batch gas burning
- **Load Testing**: Tools to stress test blockchain clients with high gas transactions

## Features

### Smart Contract Methods

- **burnGas(uint256 targetGas)**: Burns approximately the specified amount of gas using storage operations and loops
- **burnGasPrecise(uint256 targetGas)**: Burns gas using exponential operations for more precise control
- **burnGasWithHash(uint256 targetGas)**: Burns gas using SHA256 operations (very expensive)
- **getGasLeft()**: Returns the current gas remaining
- **getStorageLength()**: Returns the number of items stored
- **clearStorage()**: Clears the storage array to reset contract state

### Testing Scripts

- **burn-gas.sh**: Send a single gas burn transaction
- **spam-burn-gas.sh**: Send multiple gas burn transactions as fast as possible

## Prerequisites

1. Install Foundry:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

2. Install dependencies:
```bash
forge install foundry-rs/forge-std --no-commit
```

3. Install `jq` for JSON parsing (used in scripts):
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

## Build and Test

```bash
# Build the contracts
forge build

# Run tests
forge test

# Run tests with verbose output
forge test -vv

# Run specific test for 8M gas
forge test --match-test testBurn8MillionGas -vvv
```

## Deployment

1. Set your private key as an environment variable:
```bash
export PRIVATE_KEY=your_private_key_here
```

2. Deploy to a network:
```bash
# Deploy to local Anvil
anvil
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Deploy to Berachain Artio testnet
forge script script/Deploy.s.sol --rpc-url https://artio.rpc.berachain.com --broadcast --verify
```

## Environment Variables

The scripts use the following environment variables:

- **EL_ETHRPC_URL**: RPC endpoint URL (defaults to `https://bepolia.rpc.berachain.com`)
- **PRIVATE_KEY**: Your private key for signing transactions

## Scripts Usage

### Single Gas Burn (`burn-gas.sh`)

Burns a specified amount of gas in a single transaction.

```bash
# Usage
./scripts/burn-gas.sh [GAS_AMOUNT]

# Examples
./scripts/burn-gas.sh 8000000                    # Burn 8M gas
./scripts/burn-gas.sh 11000000                   # Burn 11M gas
./scripts/burn-gas.sh                            # Burn 8M gas (default)

# With custom RPC
export EL_ETHRPC_URL="http://localhost:8545"
./scripts/burn-gas.sh 8000000
```

### Spam Gas Burn (`spam-burn-gas.sh`)

Sends multiple gas burn transactions as fast as possible without waiting for confirmations.

```bash
# Usage
./scripts/spam-burn-gas.sh [NUM_TRANSACTIONS] [GAS_AMOUNT]

# Examples
./scripts/spam-burn-gas.sh 100 8000000           # Send 100 transactions, 8M gas each
./scripts/spam-burn-gas.sh 50 11000000           # Send 50 transactions, 11M gas each
./scripts/spam-burn-gas.sh 10                    # Send 10 transactions, 8M gas each (default)
./scripts/spam-burn-gas.sh                       # Send 10 transactions, 8M gas each (default)

# With custom RPC
export EL_ETHRPC_URL="http://192.168.2.69:41003"
./scripts/spam-burn-gas.sh 100 8000000
```

## Manual Cast Commands

After deployment, you can use Cast to interact with the contract directly. Replace `CONTRACT_ADDRESS` with your deployed contract address.

### Basic Gas Burning

```bash
# Burn 1 million gas
cast send CONTRACT_ADDRESS "burnGas(uint256)" 1000000 --private-key YOUR_PRIVATE_KEY

# Burn 8 million gas (the problematic amount)
cast send CONTRACT_ADDRESS "burnGas(uint256)" 8000000 --private-key YOUR_PRIVATE_KEY
```

### Precise Gas Burning

```bash
# Burn 2 million gas using exponential operations
cast send CONTRACT_ADDRESS "burnGasPrecise(uint256)" 2000000 --private-key YOUR_PRIVATE_KEY

# Burn 5 million gas using hash operations
cast send CONTRACT_ADDRESS "burnGasWithHash(uint256)" 5000000 --private-key YOUR_PRIVATE_KEY
```

### Query Functions

```bash
# Get current gas left
cast call CONTRACT_ADDRESS "getGasLeft()"

# Get storage length
cast call CONTRACT_ADDRESS "getStorageLength()"
```

### Clear Storage

```bash
# Clear the storage array
cast send CONTRACT_ADDRESS "clearStorage()" --private-key YOUR_PRIVATE_KEY
```

## Gas Estimation

To estimate gas before sending transactions:

```bash
# Estimate gas for burning 8M gas
cast estimate CONTRACT_ADDRESS "burnGas(uint256)" 8000000

# Estimate gas for precise burning
cast estimate CONTRACT_ADDRESS "burnGasPrecise(uint256)" 8000000

# Estimate gas for hash-based burning
cast estimate CONTRACT_ADDRESS "burnGasWithHash(uint256)" 8000000
```

## Testing Scenarios

### Client Behavior Testing

Test how different clients handle large transactions:

1. **Geth vs Reth Comparison**: Some clients may not seal very large transactions
2. **Mempool Behavior**: Monitor how transactions propagate through the network
3. **Block Gas Limits**: Test transactions near the block gas limit

### Load Testing

Use the spam script to stress test the network:

```bash
# Send 100 transactions with 8M gas each
./scripts/spam-burn-gas.sh 100 8000000

# Send 50 transactions with 11M gas each
./scripts/spam-burn-gas.sh 50 11000000
```

### Rate Limiting Testing

Test RPC endpoint rate limits:

```bash
# Test with public RPC (rate limited)
export EL_ETHRPC_URL="https://bepolia.rpc.berachain.com"
./scripts/spam-burn-gas.sh 100 8000000

# Test with local RPC (no rate limits)
export EL_ETHRPC_URL="http://192.168.2.69:41003"
./scripts/spam-burn-gas.sh 100 8000000
```

## Results and Monitoring

### Script Output

The scripts create timestamped result directories:

```
spam-results-20241201-143022/
├── transactions.log          # CSV log of all transactions
├── summary.txt              # Test summary
└── tx_1.json, tx_2.json...  # Individual transaction results
```

### Transaction Log Format

The `transactions.log` file contains CSV data:
```
timestamp,transaction_number,status,nonce_or_hash
1701445822,1,SENT,123
1701445823,2,SENT,124
...
```

### Monitoring Commands

```bash
# Check transaction status
cast tx TX_HASH --rpc-url YOUR_RPC_URL

# Get transaction receipt
cast receipt TX_HASH --rpc-url YOUR_RPC_URL

# Monitor gas prices
cast gas-price --rpc-url YOUR_RPC_URL
```

## Troubleshooting

### Common Issues

1. **"already known" errors**: The spam script handles nonce management automatically
2. **Rate limiting**: Use a local RPC endpoint for high-frequency testing
3. **Out of gas errors**: Increase gas limit or reduce gas amount
4. **Transaction failures**: Check RPC endpoint connectivity

### Debugging Commands

```bash
# Check RPC connectivity
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  YOUR_RPC_URL

# Check account balance
cast balance ACCOUNT_ADDRESS --rpc-url YOUR_RPC_URL

# Check nonce
cast nonce ACCOUNT_ADDRESS --rpc-url YOUR_RPC_URL
```

### Performance Tips

1. **Use local RPC**: Avoid rate limits with local endpoints
2. **Batch transactions**: Use the spam script for multiple transactions
3. **Monitor resources**: Large gas transactions can be resource-intensive
4. **Test incrementally**: Start with smaller gas amounts

## Contract Addresses

After deployment, save your contract address for easy reference:

```bash
# Set contract address as environment variable
export GAS_BURNER_ADDRESS=0x...

# Use in commands
cast send $GAS_BURNER_ADDRESS "burnGas(uint256)" 8000000 --private-key YOUR_PRIVATE_KEY
```

## Notes

- The contract uses storage operations which are expensive (~20k gas each)
- Gas estimation may not be accurate for very large amounts
- Different burning methods may have different efficiency
- The scripts use nonce management to prevent "already known" errors
- Results are saved in timestamped directories for analysis
- Use `EL_ETHRPC_URL` environment variable to easily switch between RPC endpoints 