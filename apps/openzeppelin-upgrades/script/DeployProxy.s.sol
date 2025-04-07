// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../src/DeFiTokenV1.sol";
import "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract DeployProxy is Script {
    function run() public {
        vm.startBroadcast();

        address proxy = Upgrades.deployUUPSProxy(
            "DeFiTokenV1.sol:DeFiToken",
            abi.encodeCall(DeFiToken.initialize, (msg.sender))
        );

        vm.stopBroadcast();

        console.log("Proxy Address:", address(proxy));
        console.log("Token Name:", DeFiToken(proxy).name());
    }
}
