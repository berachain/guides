// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BatchTransaction
 * @dev Contract for executing multiple transactions in a single atomic operation using EIP-7702
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

    /**
     * @dev Execute a batch of transactions
     * @param transactions Array of transactions to execute
     */
    function execute(Transaction[] calldata transactions) external {
        // Execute each transaction
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

    /**
     * @dev Deploy a contract using CREATE2
     * @param bytecode The creation code of the contract
     * @param salt The salt for CREATE2
     * @return deployed The address of the deployed contract
     */
    function deployCreate2(bytes memory bytecode, bytes32 salt) public returns (address deployed) {
        require(bytecode.length != 0, "Bytecode is empty");
        assembly {
            deployed := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        require(deployed != address(0), "CREATE2: Failed on deploy");
    }
} 