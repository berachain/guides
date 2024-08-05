// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../src/BingBongToken2.sol";
import "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract DeployAndUpgrade is Script {
    function run() public {
        address proxy = DEPLOYED_PROXY_ADDRESS;
        vm.startBroadcast();

        Upgrades.upgradeProxy(
            proxy,
            "BingBongToken2.sol:BingBongToken2",
            abi.encodeWithSelector(BingBongToken2.updateName.selector)
        );

        vm.stopBroadcast();

        console.log("Token Name:", BingBongToken2(proxy).name());
    }
}
