// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title VerifyConfiguration
 * @notice Verifies the complete LayerZero OFT setup including peers, libraries, and DVNs
 * @dev Checks all critical configurations needed for bridging to work properly
 */
contract VerifyConfiguration is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
    uint32 constant BERACHAIN_EID = 30362;
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
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address baseSendLib = vm.envAddress("BASE_SEND_LIB_ADDRESS");
        address baseReceiveLib = vm.envAddress("BASE_RECEIVE_LIB_ADDRESS");
        address berachainSendLib = vm.envAddress("BERACHAIN_SEND_LIB_ADDRESS");
        address berachainReceiveLib = vm.envAddress("BERACHAIN_RECEIVE_LIB_ADDRESS");

        IMessageLibManager baseEndpoint = IMessageLibManager(BASE_ENDPOINT);
        IMessageLibManager berachainEndpoint = IMessageLibManager(BERACHAIN_ENDPOINT);
        IOAppCore baseAdapter = IOAppCore(baseAdapterAddress);
        IOAppCore berachainOft = IOAppCore(berachainOftAddress);

        console.log("=== LayerZero OFT Configuration Verification ===");
        console.log("");

        // 1. Verify Peer Connections
        console.log("1. Peer Connections:");
        bytes32 basePeer = baseAdapter.peers(BERACHAIN_EID);
        bytes32 berachainPeer = berachainOft.peers(BASE_EID);

        if (basePeer == bytes32(uint256(uint160(berachainOftAddress)))) {
            console.log("  [OK] Base Adapter -> Berachain OFT: Connected");
        } else {
            console.log("  [ERROR] Base Adapter -> Berachain OFT: NOT CONNECTED");
            console.log("    Expected:", berachainOftAddress);
            console.log("    Got:", uint256(basePeer));
        }

        if (berachainPeer == bytes32(uint256(uint160(baseAdapterAddress)))) {
            console.log("  [OK] Berachain OFT -> Base Adapter: Connected");
        } else {
            console.log("  [ERROR] Berachain OFT -> Base Adapter: NOT CONNECTED");
            console.log("    Expected:", baseAdapterAddress);
            console.log("    Got:", uint256(berachainPeer));
        }
        console.log("");

        // 2. Verify Library Configurations
        console.log("2. Library Configurations:");

        // Base send library
        address baseCurrentSendLib = baseEndpoint.getSendLibrary(baseAdapterAddress, BERACHAIN_EID);
        if (baseCurrentSendLib == baseSendLib) {
            console.log("  [OK] Base Send Library: Configured");
        } else {
            console.log("  [ERROR] Base Send Library: MISMATCH");
            console.log("    Expected:", baseSendLib);
            console.log("    Got:", baseCurrentSendLib);
        }

        // Base receive library
        (address baseCurrentReceiveLib, bool baseIsDefault) =
            baseEndpoint.getReceiveLibrary(baseAdapterAddress, BERACHAIN_EID);
        if (baseCurrentReceiveLib == baseReceiveLib) {
            console.log("  [OK] Base Receive Library: Configured");
        } else {
            console.log("  [ERROR] Base Receive Library: MISMATCH");
            console.log("    Expected:", baseReceiveLib);
            console.log("    Got:", baseCurrentReceiveLib);
        }

        // Berachain send library
        address berachainCurrentSendLib = berachainEndpoint.getSendLibrary(berachainOftAddress, BASE_EID);
        if (berachainCurrentSendLib == berachainSendLib) {
            console.log("  [OK] Berachain Send Library: Configured");
        } else {
            console.log("  [ERROR] Berachain Send Library: MISMATCH");
            console.log("    Expected:", berachainSendLib);
            console.log("    Got:", berachainCurrentSendLib);
        }

        // Berachain receive library
        (address berachainCurrentReceiveLib, bool berachainIsDefault) =
            berachainEndpoint.getReceiveLibrary(berachainOftAddress, BASE_EID);
        if (berachainCurrentReceiveLib == berachainReceiveLib) {
            console.log("  [OK] Berachain Receive Library: Configured");
        } else {
            console.log("  [ERROR] Berachain Receive Library: MISMATCH");
            console.log("    Expected:", berachainReceiveLib);
            console.log("    Got:", berachainCurrentReceiveLib);
        }
        console.log("");

        // 3. Verify DVN Configurations
        console.log("3. DVN Configurations:");

        // Base receive DVNs
        try baseEndpoint.getConfig(baseAdapterAddress, baseReceiveLib, BERACHAIN_EID, CONFIG_TYPE_ULN) returns (
            bytes memory baseDvnConfig
        ) {
            UlnConfig memory baseUlnConfig = abi.decode(baseDvnConfig, (UlnConfig));
            if (baseUlnConfig.requiredDVNCount > 0) {
                console.log("  [OK] Base Receive DVNs: Configured");
                console.log("    Required DVNs:", baseUlnConfig.requiredDVNCount);
                console.log("    Optional DVNs:", baseUlnConfig.optionalDVNCount);
                console.log("    Confirmations:", baseUlnConfig.confirmations);
            } else {
                console.log("  [ERROR] Base Receive DVNs: NOT CONFIGURED");
            }
        } catch {
            console.log("  [ERROR] Base Receive DVNs: ERROR READING CONFIG");
        }

        // Berachain receive DVNs
        try berachainEndpoint.getConfig(berachainOftAddress, berachainReceiveLib, BASE_EID, CONFIG_TYPE_ULN) returns (
            bytes memory berachainDvnConfig
        ) {
            UlnConfig memory berachainUlnConfig = abi.decode(berachainDvnConfig, (UlnConfig));
            if (berachainUlnConfig.requiredDVNCount > 0) {
                console.log("  [OK] Berachain Receive DVNs: Configured");
                console.log("    Required DVNs:", berachainUlnConfig.requiredDVNCount);
                console.log("    Optional DVNs:", berachainUlnConfig.optionalDVNCount);
                console.log("    Confirmations:", berachainUlnConfig.confirmations);
            } else {
                console.log("  [ERROR] Berachain Receive DVNs: NOT CONFIGURED");
            }
        } catch {
            console.log("  [ERROR] Berachain Receive DVNs: ERROR READING CONFIG");
        }
        console.log("");

        console.log("=== Verification Complete ===");
    }
}
