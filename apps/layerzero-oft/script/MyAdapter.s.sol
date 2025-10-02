// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {MyAdapter} from "../src/MyAdapter.sol";

// Deploys OFT adapter to Base Mainnet
contract MyAdapterScript is Script {
    address constant LAYERZERO_ENDPOINT =
        0x1a44076050125825900e736c501f859c50fE728c;

    function run() public {
        // Setup
        address baseTokenAddress = vm.envAddress("BASE_TOKEN_ADDRESS");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        // Deploy
        MyAdapter adapter = new MyAdapter(
            baseTokenAddress,
            LAYERZERO_ENDPOINT,
            vm.addr(privateKey) // Wallet address of signer
        );

        console.log("Adapter deployed at:", address(adapter));
        console.log("Token address:", baseTokenAddress);

        vm.stopBroadcast();
    }
}
