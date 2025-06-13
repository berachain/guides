// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {BlockhashConsumer} from "../src/Eip2935GasComparison.sol";
import {console2} from "forge-std/Script.sol";

/// Run tests by running: `source .env && forge test --fork-url $BEPOLIA_RPC_URL --fork-block-number 5045482 -vvv`
contract GasComparisonTest is Test {
    BlockhashConsumer public consumer;
    bytes32 public expectedHash;
    bytes32 public blockHash;
    uint256 public testBlock;

    function setUp() public {
        consumer = new BlockhashConsumer();
        vm.roll(5045482 - 8190); // Just within the HISTORY_SERVE_WINDOW (8191 blocks from current blockNumber)
        testBlock = block.number - 1;
        expectedHash = blockhash(testBlock);
        consumer.submitOracleBlockhash(testBlock, expectedHash);
        console2.log("Current testBlock: %s", testBlock);
    }

    function testGas_ReadWithSLOAD() public {
        consumer.storeWithSSTORE(testBlock);
        blockHash = consumer.readWithSLOAD(testBlock);
        assertEq(expectedHash, blockHash);
    }

    // NOTE: this test fails if you do not run against a fork-url because even though we have rolled the chain to a workable blocknumber, the system contract does not exist on the Foundry test VM, so the staticcall doesn't revert, but it doesn't return any meanigful data, thus triggering data.length reversion found in `eip2935GasComparison.readWithGet()` function
    function testGas_ReadWithGet() public {
        blockHash = consumer.readWithGet(testBlock);
        assertEq(expectedHash, blockHash);
    }

    function testGas_OracleSubmission() public {
        consumer.submitOracleBlockhash(testBlock, blockhash(testBlock));
        blockHash = consumer.readFromOracle(testBlock);
        assertEq(expectedHash, blockHash);
    }
}
