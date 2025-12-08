// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";

/**
 * @title FixBasePeer
 * @notice Sets the correct peer for Base EID 30184 (not 30110 which is Arbitrum)
 */
contract FixBasePeer is Script {
    uint32 constant BASE_EID = 30184; // Correct Base EID
    uint32 constant WRONG_BASE_EID = 30110; // Arbitrum EID (wrong)

    function run() public {
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IOAppCore oft = IOAppCore(berachainOftAddress);

        console.log("=== Fixing Base Peer Configuration ===");
        console.log("Berachain OFT:", berachainOftAddress);
        console.log("Base Adapter:", baseAdapterAddress);
        console.log("");

        // Check current (wrong) peer
        bytes32 wrongPeer = oft.peers(WRONG_BASE_EID);
        console.log("Current peer for EID 30110 (Arbitrum):", address(uint160(uint256(wrongPeer))));
        console.log("");

        // Check if correct peer is already set
        bytes32 currentPeer = oft.peers(BASE_EID);
        if (currentPeer == bytes32(uint256(uint160(baseAdapterAddress)))) {
            console.log("[OK] Peer already set correctly for Base EID 30184");
        } else {
            console.log("Setting peer for Base EID 30184...");
            oft.setPeer(BASE_EID, bytes32(uint256(uint160(baseAdapterAddress))));
            console.log("[OK] Peer set successfully for Base EID 30184");
        }
        console.log("");

        // Verify
        bytes32 verifiedPeer = oft.peers(BASE_EID);
        address peerAddress = address(uint160(uint256(verifiedPeer)));
        if (peerAddress == baseAdapterAddress) {
            console.log("[OK] Peer verified: Connected to Base Adapter");
        } else {
            console.log("[ERROR] Peer verification failed!");
            console.log("  Expected:", baseAdapterAddress);
            console.log("  Got:", peerAddress);
        }

        vm.stopBroadcast();
    }
}
