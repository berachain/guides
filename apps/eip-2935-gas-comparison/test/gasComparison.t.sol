// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {BlockhashConsumer, MockBlockhashHistory} from "../src/Eip2935GasComparison.sol";

contract GasComparisonTest is Test {
    MockBlockhashHistory public history;
    BlockhashConsumer public consumer;

    uint256 public testBlock;

    function setUp() public {
        history = new MockBlockhashHistory();
        consumer = new BlockhashConsumer(address(history));

        testBlock = block.number - 1;
        bytes32 hash = blockhash(testBlock);
        history.set(testBlock, hash);
        consumer.submitOracleBlockhash(testBlock, hash);
    }

    function testGas_StoreWithSSTORE() public {
        consumer.storeWithSSTORE(testBlock);
    }

    function testGas_ReadWithSLOAD() public view returns (bytes32) {
        return consumer.readWithSLOAD(testBlock);
    }

    function testGas_ReadWithGetCold() public view returns (bytes32) {
        return consumer.readWithGet(testBlock); // cold access
    }

    // // Warm read: access twice, count the second
    // function testGas_ReadWithGet_Warm() public view returns (bytes32) {
    //     // warm-up access
    //     consumer.readWithGet(testBlock);
    //     // measure this access — gas report will include both
    //     return consumer.readWithGet(testBlock);
    // }

    function testGas_OracleSubmission() public {
        consumer.submitOracleBlockhash(testBlock, blockhash(testBlock));
    }

    function testGas_ReadFromOracle() public view returns (bytes32) {
        return consumer.readFromOracle(testBlock);
    }
}
