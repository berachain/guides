// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../src/BingBongToken.sol";
import "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract DeployProxy is Script {
    function run() public {
        vm.startBroadcast();

        address proxy = Upgrades.deployUUPSProxy(
            "BingBongToken.sol:BingBongToken",
            abi.encodeCall(BingBongToken.initialize, (msg.sender))
        );

        vm.stopBroadcast();

        console.log("Proxy Address:", address(proxy));
        console.log("Token Name:", BingBongToken(proxy).name());
    }
}
