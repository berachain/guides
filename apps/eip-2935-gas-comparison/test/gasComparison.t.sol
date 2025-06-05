// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {BlockhashConsumer} from "../src/Eip2935GasComparison.sol";
import {console2} from "forge-std/Script.sol";

contract GasComparisonTest is Test {
    BlockhashConsumer public consumer;
    bytes32 public expectedHash;
    bytes32 public blockHash;
    uint256 public testBlock;

    function setUp() public {
        consumer = new BlockhashConsumer();
        vm.roll(8900);
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

    // NOTE: the EIP-2935 method of getting the blockhash will fail within foundry tests because even though we have rolled the chain to a workable blocknumber, the system contract does not exist on the Foundry test VM, so the staticcall doesn't revert, but it doesn't return any meanigful data, thus triggering data.length reversion found in `eip2935GasComparison.readWithGet()` function
    function testGas_ReadWithGet() public {
        vm.expectRevert("Input too short");
        blockHash = consumer.readWithGet(testBlock); // cold access
    }

    function testGas_OracleSubmission() public {
        consumer.submitOracleBlockhash(testBlock, blockhash(testBlock));
        blockHash = consumer.readFromOracle(testBlock);
        assertEq(expectedHash, blockHash);
    }
}
