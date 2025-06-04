# Batch Transactions & EIP-7702 Delegation Guide

## Overview

This guide demonstrates how to use [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) to enable a user wallet (EOA) to delegate control to a smart contract, allowing atomic batch execution of transactions using a **single nonce**. This is achieved using Foundry's advanced testing features and Solmate's minimal ERC20 implementation.

## What is EIP-7702?

EIP-7702 is a proposed Ethereum standard that allows an Externally Owned Account (EOA, i.e., a regular wallet) to temporarily delegate its transaction execution to a smart contract. This means:
- A user can sign a special delegation message authorizing a contract to act on their behalf for a single nonce.
- The EOA's code is temporarily replaced, enabling smart contract logic (like batching, validation, etc.) for that transaction.
- After the transaction, the EOA reverts to normal.

**Key Benefits:**
- Enables account abstraction features (like batching, paymasters, etc.) without losing EOA compatibility.
- Allows atomic, multi-step operations (e.g., deploy a token and mint to multiple users) in a single transaction, with a single signature and nonce.

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/batch-transactions.git
cd batch-transactions
```

2. Install dependencies:
```bash
forge install
```

3. Create a `.env` file in the root directory:
```bash
PRIVATE_KEY=your_private_key_here
RPC_URL=https://bepolia.rpc.berachain.com
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

## Usage

### Deploying the Contract

1. Deploy the BatchTransaction contract:
```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url $RPC_URL --broadcast
```

### Verifying the Contract

To verify the contract on Berachain's Bepolia testnet:

```bash
forge verify-contract \
  --verifier-url https://api-testnet.berascan.com/api \
  --chain-id 80069 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  <CONTRACT_ADDRESS> \
  src/BatchTransaction.sol:BatchTransaction
```

Replace `<CONTRACT_ADDRESS>` with your deployed contract address.

### Setting Up Your Wallet

To use the batch transaction functionality with your wallet:

1. Deploy the BatchTransaction contract to your desired network
2. Store the deployed contract address
3. Use the contract's `execute` function to perform batch operations

### Example: Batch Deploy & Mint

```solidity
// 1. Precompute the token address
bytes memory bytecode = type(UrsaToken).creationCode;
bytes32 salt = keccak256("ursa-token-salt");
address predicted = computeCreate2Address(address(batchTx), salt, keccak256(bytecode));

// 2. Prepare the batch
BatchTransaction.Transaction[] memory txs = new BatchTransaction.Transaction[](4);
// Deploy token
txs[0] = BatchTransaction.Transaction({
    target: address(batchTx),
    value: 0,
    data: abi.encodeWithSignature("deployCreate2(bytes,bytes32)", bytecode, salt)
});
// Mint to board members
for (uint256 i = 0; i < 3; i++) {
    txs[i+1] = BatchTransaction.Transaction({
        target: predicted,
        value: 0,
        data: abi.encodeWithSelector(ERC20.transfer.selector, boardMembers[i], BOARD_MEMBER_SHARE)
    });
}

// 3. Delegate EOA to batch contract for a single nonce
Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(batchTx), alicePk);
vm.prank(alice);
vm.attachDelegation(signedDelegation);
batchTx.execute(txs);
```

## Key Functions

### 1. `execute`
Executes a batch of transactions atomically. If any transaction fails, the whole batch reverts.

```solidity
function execute(Transaction[] calldata transactions) external {
    for (uint256 i = 0; i < transactions.length; i++) {
        Transaction calldata transaction = transactions[i];
        (bool success, bytes memory reason) = transaction.target.call{value: transaction.value}(transaction.data);
        if (!success) {
            emit TransactionFailed(i, reason);
            revert("Transaction failed");
        }
    }
    emit BatchExecuted(msg.sender, transactions.length);
}
```

### 2. `deployCreate2`
Deploys a contract at a deterministic address using CREATE2.

```solidity
function deployCreate2(bytes memory bytecode, bytes32 salt) public returns (address deployed) {
    require(bytecode.length != 0, "Bytecode is empty");
    assembly {
        deployed := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
    }
    require(deployed != address(0), "CREATE2: Failed on deploy");
}
```

## Running Tests

To run the test suite:

```bash
forge test
```

For verbose output:

```bash
forge test -vv
```

## Benefits

- **Security:** No risk of partial execution—either all actions succeed, or none do.
- **User Experience:** One signature, one transaction, many actions.
- **Future-Proof:** Demonstrates the power of EIP-7702 and account abstraction for next-gen wallets.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
