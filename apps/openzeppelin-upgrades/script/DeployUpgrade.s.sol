// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../src/DeFiTokenV2.sol";
import "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract DeployAndUpgrade is Script {
    function run() public {
        // Replace with your proxy address
        address proxy = 0x0000000000000000000000000000000000000000;
        vm.startBroadcast();

        Upgrades.upgradeProxy(
            proxy,
            "DeFiTokenV2.sol:DeFiTokenV2",
            abi.encodeCall(DeFiTokenV2.initialize, ())
        );

        vm.stopBroadcast();

        console.log("Token Name:", DeFiTokenV2(proxy).name());
    }
}
