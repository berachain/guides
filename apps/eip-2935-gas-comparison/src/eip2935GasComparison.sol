// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BlockhashConsumer EIP2935 Educational Contract
/// @notice Consumer contract demonstrating pre-EIP-2935, post-EIP-2935, and oracle-based patterns
/// @dev This educational example contract, as is, showcases methods to obtain, store, and read blockhashes. It primarily is made to showcase how to carry out these various methods, and more-so to be used with `DeployGasComparison.s.sol` and `run_gas_comparison.sh` to showcase the gas savings offered by EIP-2935
contract BlockhashConsumer {
    mapping(uint256 => bytes32) public stored;
    mapping(uint256 => bytes32) public oracleHashes;

    address public immutable historyAddress;
    address public constant systemContract = 0x0000F90827F1C53a10cb7A02335B175320002935;

    uint256 constant HISTORIC_SERVE_WINDOW = 8192; // # of blocks that EIP2935 stores historic block hashes

    error PAST_HISTORY_SERVE_WINDOW();
    error BEYOND_HISTORY_SERVE_WINDOW();

    /// Pre-EIP-2935 pattern: manually store blockhash for future use

    function storeWithSSTORE(uint256 blockNumber) external {
        stored[blockNumber] = blockhash(blockNumber);
    }

    function readWithSLOAD(uint256 blockNumber) external view returns (bytes32) {
        return stored[blockNumber];
    }

    /// Post-EIP-2935 pattern: read from protocol-managed contract

    function readWithGet(uint256 blockNumber) external view returns (bytes32 result) {
        if (blockNumber < (block.number - HISTORIC_SERVE_WINDOW)) revert PAST_HISTORY_SERVE_WINDOW();
        if ((blockNumber) > block.number) revert BEYOND_HISTORY_SERVE_WINDOW();

        bytes32 blockNumberBigEndian = bytes32(uint256(blockNumber));
        bytes memory rawCallData = abi.encodePacked(blockNumberBigEndian);
        (bool ok, bytes memory data) = systemContract.staticcall(rawCallData);
        require(ok, "EIP-2935 system contract call failed");
        require(data.length >= 32, "Input too short");
        assembly {
            result := mload(add(data, 32)) // skip length prefix
        }

        return result;
    }

    /// Oracle-based pattern: simulate offchain submission

    function submitOracleBlockhash(uint256 blockNumber, bytes32 hash) external {
        oracleHashes[blockNumber] = hash;
    }

    function readFromOracle(uint256 blockNumber) external view returns (bytes32) {
        return oracleHashes[blockNumber];
    }
}
