// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {BlockhashConsumer} from "../src/Eip2935GasComparison.sol";

/// @dev This is to be ran from `./run_gas_comparison.sh` but you can run it separately from this file by using: `source .env && forge script script/eip2935GasComparison.s.sol:eip2935GasComparison.s --rpc-url $TEST_RPC_URL --private-key $EOA_PRIVATE_KEY --broadcast -vvvv`
contract eip2935GasComparison is Script {
    function run() external {
        vm.startBroadcast();

        BlockhashConsumer consumer = new BlockhashConsumer();

        console2.log("Consumer contract deployed at: %s", address(consumer));
        console2.log("Current block: %s", block.number);

        uint256 testBlock = block.number >= 2 ? block.number - 2 : 0;
        bytes32 hash = blockhash(testBlock);

        // Simulate Pre-EIP-2935 pattern where they manually store blockhash for future use
        consumer.storeWithSSTORE(testBlock);

        // Use system contract as per EIP-2935

        // Simulate Pre-EIP-2935 pattern using oracles
        consumer.submitOracleBlockhash(testBlock, hash);

        vm.stopBroadcast();
    }
}
