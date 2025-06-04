// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {SimpleDelegate} from "../src/SimpleDelegate.sol";

// source .env && forge script script/Implementation.s.sol:SimpleDelegateScript --rpc-url $TEST_RPC_URL --private-key $EOA_PRIVATE_KEY --broadcast -vvvv
contract SimpleDelegateScript is Script {
    SimpleDelegate public simpleDelegate;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();
        simpleDelegate = new SimpleDelegate();
        vm.stopBroadcast();
    }
}
