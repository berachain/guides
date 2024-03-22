// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script} from "forge-std/Script.sol";
import "../src/MyOFT.sol";

contract MyOFTScript is Script {
    address constant LAYERZERO_ENDPOINT =
        0x6EDCE65403992e310A62460808c4b910D972f10f;

    uint32 constant SEPOLIA_ENDPOINT_ID = 40161;

    function run() public {
        // Setup
        address SEPOLIA_ADAPTER_ADDRESS = vm.envAddress(
            "SEPOLIA_ADAPTER_ADDRESS"
        );
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        // Deploy
        MyOFT myOFT = new MyOFT(
            "Layer Zero UNI",
            "lzUNI",
            LAYERZERO_ENDPOINT,
            vm.addr(privateKey) // Wallet address of signer
        );

        // Hook up Berachain OFT to Sepolia's adapter
        myOFT.setPeer(
            SEPOLIA_ENDPOINT_ID,
            bytes32(uint256(uint160(SEPOLIA_ADAPTER_ADDRESS)))
        );
        vm.stopBroadcast();
    }
}
