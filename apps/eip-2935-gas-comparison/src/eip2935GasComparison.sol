// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface for EIP-2935-style blockhash history system contract
interface IBlockhashHistory {
    function get(uint256 blockNumber) external view returns (bytes32);
}

/// @notice Mock contract simulating the EIP-2935 system contract
contract MockBlockhashHistory {
    mapping(uint256 => bytes32) private hashes;

    function set(uint256 blockNumber, bytes32 hash) external {
        hashes[blockNumber] = hash;
    }

    function get(uint256 blockNumber) external view returns (bytes32) {
        require(block.number > blockNumber, "future block");
        require(block.number - blockNumber <= 8191, "out of range");
        return hashes[blockNumber];
    }
}

/// @notice Consumer contract demonstrating pre-EIP-2935, post-EIP-2935, and oracle-based patterns
contract BlockhashConsumer {
    mapping(uint256 => bytes32) public stored;
    mapping(uint256 => bytes32) public oracleHashes;

    address public immutable historyAddress;

    constructor(address _historyAddress) {
        historyAddress = _historyAddress;
    }

    // Pre-EIP-2935 pattern: manually store blockhash for future use
    function storeWithSSTORE(uint256 blockNumber) external {
        stored[blockNumber] = blockhash(blockNumber);
    }

    function readWithSLOAD(uint256 blockNumber) external view returns (bytes32) {
        return stored[blockNumber];
    }

    // Post-EIP-2935 pattern: read from protocol-managed contract
    function readWithGet(uint256 blockNumber) external view returns (bytes32) {
        return IBlockhashHistory(historyAddress).get(blockNumber);
    }

    // Oracle-based pattern: simulate offchain submission
    function submitOracleBlockhash(uint256 blockNumber, bytes32 hash) external {
        oracleHashes[blockNumber] = hash;
    }

    function readFromOracle(uint256 blockNumber) external view returns (bytes32) {
        return oracleHashes[blockNumber];
    }
}
