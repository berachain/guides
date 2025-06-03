// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// import "forge-std/Script.sol";
// import "forge-std/console2.sol";
import {Script, console} from "forge-std/Script.sol";
import {MockBlockhashHistory, BlockhashConsumer} from "../src/Eip2935GasComparison.sol";

/// @dev Run script on anvil fork: `source .env && forge script script/DeployGasComparison.s.sol:DeployGasComparison --rpc-url $TEST_RPC_URL --private-key $PK_1 --broadcast -vvvv`
contract DeployGasComparison is Script {
function run() external {
    vm.startBroadcast();

    MockBlockhashHistory history = new MockBlockhashHistory();
    BlockhashConsumer consumer = new BlockhashConsumer(address(history));

    console.log("History contract deployed at: %s", address(history));
    console.log("Consumer contract deployed at: %s", address(consumer));
    console.log("Current block: %s", block.number);

    uint256 testBlock = block.number >= 2 ? block.number - 2 : 0;
    bytes32 hash = blockhash(testBlock);

    history.set(testBlock, hash);
    consumer.submitOracleBlockhash(testBlock, hash);

    console.log("Mock set and oracle submitted for block: %s", testBlock);

    bytes32 sstoreHash = consumer.stored(testBlock);
    bytes32 getHash = consumer.readWithGet(testBlock);
    bytes32 oracleHash = consumer.readFromOracle(testBlock);

    // console.log("Stored SSTORE hash: %s", sstoreHash);
    // console.log("Read via .get(): %s", getHash);
    // console.log("Read via oracle: %s", oracleHash);

    vm.stopBroadcast();
}


}