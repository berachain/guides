// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BatchTransaction
 * @dev Contract for executing multiple transactions in a single atomic operation
 */
contract BatchTransaction {
    // Struct to represent a single transaction in the batch
    struct Transaction {
        address target;
        uint256 value;
        bytes data;
    }

    // Events
    event BatchExecuted(address indexed executor, uint256 nonce, uint256 transactionCount);
    event TransactionFailed(uint256 index, bytes reason);

    // Constants
    uint256 public constant MAX_BATCH_SIZE = 100;

    // Mapping to track used nonces for replay protection
    mapping(address => uint256) public nonces;

    /**
     * @dev Execute a batch of transactions
     * @param transactions Array of transactions to execute
     * @param nonce The nonce for this batch execution
     */
    function execute(Transaction[] calldata transactions, uint256 nonce) external {
        require(transactions.length <= MAX_BATCH_SIZE, "Batch too large");
        require(transactions.length > 0, "Empty batch");
        require(nonce == nonces[msg.sender], "Invalid nonce");

        // Increment nonce before execution to prevent reentrancy
        nonces[msg.sender]++;

        for (uint256 i = 0; i < transactions.length; i++) {
            Transaction calldata transaction = transactions[i];
            (bool success, bytes memory returnData) = transaction.target.call{value: transaction.value}(transaction.data);
            
            if (!success) {
                emit TransactionFailed(i, returnData);
                revert("Transaction failed");
            }
        }

        emit BatchExecuted(msg.sender, nonce, transactions.length);
    }

    /**
     * @dev Get the current nonce for an address
     * @param account Address to get nonce for
     * @return Current nonce
     */
    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }
} 