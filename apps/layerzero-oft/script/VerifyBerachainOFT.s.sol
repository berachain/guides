// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

/**
 * @title VerifyBerachainOFT
 * @notice Comprehensive verification of Berachain OFT setup
 */
contract VerifyBerachainOFT is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    address constant BERACHAIN_OFT = 0x6CB0268387BAEFaace08b2368F21E8983Ec05988;
    address constant BASE_ADAPTER = 0x031A382C7C1AfE8587A663355804878efB56ce52;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
    uint32 constant CONFIG_TYPE_ULN = 2;

    struct UlnConfig {
        uint64 confirmations;
        uint8 requiredDVNCount;
        uint8 optionalDVNCount;
        uint8 optionalDVNThreshold;
        address[] requiredDVNs;
        address[] optionalDVNs;
    }

    function run() public view {
        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);
        IOAppCore oft = IOAppCore(BERACHAIN_OFT);

        console.log("=== Berachain OFT Configuration Verification ===");
        console.log("OFT Address:", BERACHAIN_OFT);
        console.log("");

        // 1. Check peer connection
        console.log("1. Peer Connection:");
        bytes32 peer = oft.peers(BASE_EID);
        address peerAddress = address(uint160(uint256(peer)));
        if (peerAddress == BASE_ADAPTER) {
            console.log("  [OK] Peer connected to Base Adapter");
            console.log("  Peer Address:", peerAddress);
        } else {
            console.log("  [ERROR] Peer mismatch!");
            console.log("  Expected:", BASE_ADAPTER);
            console.log("  Got:", peerAddress);
        }
        console.log("");

        // 2. Check send library
        console.log("2. Send Library Configuration:");
        address sendLib = endpoint.getSendLibrary(BERACHAIN_OFT, BASE_EID);
        if (sendLib != address(0)) {
            console.log("  [OK] Send library configured");
            console.log("  Send Library:", sendLib);
        } else {
            console.log("  [ERROR] Send library not configured!");
        }
        console.log("");

        // 3. Check receive library
        console.log("3. Receive Library Configuration:");
        (address receiveLib, bool isDefault) = endpoint.getReceiveLibrary(BERACHAIN_OFT, BASE_EID);
        if (receiveLib != address(0)) {
            console.log("  [OK] Receive library configured");
            console.log("  Receive Library:", receiveLib);
            console.log("  Is Default:", isDefault);
        } else {
            console.log("  [ERROR] Receive library not configured!");
        }
        console.log("");

        // 4. Check ULN configuration
        console.log("4. ULN (DVN) Configuration:");
        bytes memory config = endpoint.getConfig(BERACHAIN_OFT, receiveLib, BASE_EID, CONFIG_TYPE_ULN);
        if (config.length > 0) {
            UlnConfig memory ulnConfig = abi.decode(config, (UlnConfig));
            console.log("  [OK] ULN config found");
            console.log("  Confirmations:", ulnConfig.confirmations);
            console.log("  Required DVN Count:", ulnConfig.requiredDVNCount);
            console.log("  Optional DVN Count:", ulnConfig.optionalDVNCount);
            console.log("  Required DVNs:");
            for (uint256 i = 0; i < ulnConfig.requiredDVNs.length; i++) {
                console.log("    - DVN", i, ":", ulnConfig.requiredDVNs[i]);
            }
            if (ulnConfig.optionalDVNs.length > 0) {
                console.log("  Optional DVNs:");
                for (uint256 i = 0; i < ulnConfig.optionalDVNs.length; i++) {
                    console.log("    - DVN", i, ":", ulnConfig.optionalDVNs[i]);
                }
            }
        } else {
            console.log("  [ERROR] No ULN config found!");
        }
        console.log("");

        // 5. Check if library is registered
        console.log("5. Library Registration:");
        bool sendLibRegistered = endpoint.isRegisteredLibrary(sendLib);
        bool receiveLibRegistered = endpoint.isRegisteredLibrary(receiveLib);
        if (sendLibRegistered) {
            console.log("  [OK] Send library is registered");
        } else {
            console.log("  [ERROR] Send library not registered!");
        }
        if (receiveLibRegistered) {
            console.log("  [OK] Receive library is registered");
        } else {
            console.log("  [ERROR] Receive library not registered!");
        }
        console.log("");

        console.log("=== Verification Complete ===");
    }
}
