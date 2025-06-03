// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BlockHashTracker {
    mapping(uint256 => bytes32) public storedHashes;

    function storeBlockHash(uint256 blockNumber) external {
        require(block.number - blockNumber <= 256, "Block too old");
        bytes32 hash = blockhash(blockNumber);
        require(hash != bytes32(0), "Invalid block hash");
        storedHashes[blockNumber] = hash;
    }

    function getStoredHash(uint256 blockNumber) external view returns (bytes32) {
        return storedHashes[blockNumber];
    }
}

contract BlockHashCheckerEIP2935 {
    function getOldHash(uint256 blockNumber) external view returns (bytes32) {
        return blockhash(blockNumber); // With EIP-2935 enabled, this works for any historical block
    }
}
