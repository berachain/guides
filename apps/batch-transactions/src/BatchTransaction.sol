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
    event BatchExecuted(address indexed executor, uint256 transactionCount);
    event TransactionFailed(uint256 index, bytes reason);

    // Constants
    uint256 public constant MAX_BATCH_SIZE = 100;

    /**
     * @dev Execute a batch of transactions
     * @param transactions Array of transactions to execute
     */
    function execute(Transaction[] calldata transactions) external {
        require(transactions.length <= MAX_BATCH_SIZE, "Batch too large");
        require(transactions.length > 0, "Empty batch");

        for (uint256 i = 0; i < transactions.length; i++) {
            Transaction calldata transaction = transactions[i];
            (bool success, bytes memory returnData) = transaction.target.call{value: transaction.value}(transaction.data);
            
            if (!success) {
                emit TransactionFailed(i, returnData);
                revert("Transaction failed");
            }
        }

        emit BatchExecuted(msg.sender, transactions.length);
    }
} 