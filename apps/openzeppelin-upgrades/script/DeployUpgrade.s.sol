// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.25;

// import "../src/DeFiTokenV2.sol";
// import "forge-std/Script.sol";
// import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

// contract DeployAndUpgrade is Script {
//     function run() public {
//         address proxy = DEPLOYED_PROXY_ADDRESS;
//         vm.startBroadcast();

//         Upgrades.upgradeProxy(
//             proxy,
//             "DeFiTokenV2.sol:DeFiTokenV2",
//             abi.encodeWithSelector(DeFiTokenV2.updateName.selector)
//         );

//         vm.stopBroadcast();

//         console.log("Token Name:", DeFiTokenV2(proxy).name());
//     }
// }
