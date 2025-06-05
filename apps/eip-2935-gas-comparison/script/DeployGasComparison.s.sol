// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {BlockhashConsumer} from "../src/Eip2935GasComparison.sol";

/// @dev This is to be ran from `./run_gas_comparison.sh` but you can run it separately from this file by using: `source .env && forge script script/DeployGasComparison.s.sol:DeployGasComparison --rpc-url $TEST_RPC_URL --private-key $EOA_PRIVATE_KEY --broadcast -vvvv`
contract DeployGasComparison is Script {
    function run() external {
        vm.startBroadcast();

        BlockhashConsumer consumer = new BlockhashConsumer();

        console2.log("Consumer contract deployed at: %s", address(consumer));
        console2.log("Current block: %s", block.number);

        uint256 testBlock = block.number >= 2 ? block.number - 2 : 0;
        bytes32 hash = blockhash(testBlock);

        // Simulate Pre-EIP-2935 pattern where they manually store blockhash for future use
        consumer.storeWithSSTORE(testBlock);
        bytes32 sstoreHash = consumer.readWithSLOAD(testBlock);

        // Use system contract as per EIP-2935
        bytes32 getHash = consumer.readWithGet(testBlock);

        // Simulate Pre-EIP-2935 pattern using oracles
        consumer.submitOracleBlockhash(testBlock, hash);
        console2.log("Mock set and oracle submitted for block: %s", testBlock);
        bytes32 oracleHash = consumer.readFromOracle(testBlock);

        // console2.logBytes32("Stored SSTORE hash: %s", abi.decode(sstoreHash, (bytes32)));
        // console2.logBytes32("Read via .get(): %s", abi.decode(getHash, (bytes32)));
        // console2.logBytes32("Read via oracle: %s", abi.decode(oracleHash, (bytes32)));
        vm.stopBroadcast();
    }
}
