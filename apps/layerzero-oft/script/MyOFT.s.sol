// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {MyOFT} from "../src/MyOFT.sol";

// Deploy OFT to Berachain and link to Base
contract MyOFTScript is Script {
    address constant LAYERZERO_ENDPOINT =
        0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;

    uint32 constant BASE_ENDPOINT_ID = 30110; // Base mainnet endpoint ID

    function run() public {
        // Setup
        address baseAdapterAddress = vm.envAddress(
            "BASE_ADAPTER_ADDRESS"
        );
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        // Deploy
        MyOFT myOft = new MyOFT(
            "Layer Zero My Token",
            "lzMCT",
            LAYERZERO_ENDPOINT,
            vm.addr(privateKey) // Wallet address of signer
        );

        // Hook up Berachain OFT to Base's adapter
        myOft.setPeer(
            BASE_ENDPOINT_ID,
            bytes32(uint256(uint160(baseAdapterAddress)))
        );

        console.log("OFT deployed at:", address(myOft));
        console.log("Base adapter address:", baseAdapterAddress);

        vm.stopBroadcast();
    }
}
