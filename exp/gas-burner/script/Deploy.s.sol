// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/GasBurner.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        GasBurner gasBurner = new GasBurner();
        
        console.log("GasBurner deployed at:", address(gasBurner));

        vm.stopBroadcast();
    }
} 