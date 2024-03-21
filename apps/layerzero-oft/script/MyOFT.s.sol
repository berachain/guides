// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script} from "forge-std/Script.sol";
import "../src/MyOFT.sol";

contract MyOFTScript is Script {
    address constant LAYERZERO_ENDPOINT =
        0x6EDCE65403992e310A62460808c4b910D972f10f;

    // REPLACE WITH YOUR DEPLOYED ADAPTER ON SEPOLIA
    address constant SEPOLIA_PEER = 0x0000000000000000000000000000000000000000;
    uint32 constant SEPOLIA_ENDPOINT_ID = 40161;

    function run() public {
        // Setup
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
            bytes32(uint256(uint160(SEPOLIA_PEER)))
        );
        vm.stopBroadcast();
    }
}
