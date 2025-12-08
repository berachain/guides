// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title VerifySetup
 * @notice Verifies the complete LayerZero OFT setup including peers, libraries, and configurations
 * @dev Checks all critical configurations before attempting to bridge tokens
 */
contract VerifySetup is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30110;
    uint32 constant BERACHAIN_EID = 30362;

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

        console.log("=== LayerZero OFT Setup Verification ===\n");

        // Check peers
        console.log("--- Peer Configuration ---");
        bytes32 basePeer = baseAdapter.peers(BERACHAIN_EID);
        bytes32 berachainPeer = berachainOft.peers(BASE_EID);

        bool basePeerSet = basePeer != bytes32(0);
        bool berachainPeerSet = berachainPeer != bytes32(0);

        console.log("Base -> Berachain Peer Set:", basePeerSet);
        if (basePeerSet) {
            console.log("  Peer Address:", address(uint160(uint256(basePeer))));
        } else {
            console.log("  ✗ ERROR: Peer not set!");
        }

        console.log("Berachain -> Base Peer Set:", berachainPeerSet);
        if (berachainPeerSet) {
            console.log("  Peer Address:", address(uint160(uint256(berachainPeer))));
        } else {
            console.log("  ✗ ERROR: Peer not set!");
        }
        console.log("");

        // Check Base libraries
        console.log("--- Base Adapter Library Configuration ---");
        address baseCurrentSendLib = baseEndpoint.getSendLibrary(baseAdapterAddress, BERACHAIN_EID);
        (address baseCurrentReceiveLib, bool baseIsDefault) =
            baseEndpoint.getReceiveLibrary(baseAdapterAddress, BERACHAIN_EID);

        console.log("Expected Send Library:", baseSendLib);
        console.log("Current Send Library:", baseCurrentSendLib);
        bool baseSendLibOk = baseCurrentSendLib == baseSendLib;
        console.log("Send Library Match:", baseSendLibOk);
        if (!baseSendLibOk) {
            console.log("  ✗ ERROR: Send library mismatch!");
        }

        console.log("Expected Receive Library:", baseReceiveLib);
        console.log("Current Receive Library:", baseCurrentReceiveLib);
        console.log("Is Default Library:", baseIsDefault);
        bool baseReceiveLibOk = baseCurrentReceiveLib == baseReceiveLib;
        console.log("Receive Library Match:", baseReceiveLibOk);
        if (!baseReceiveLibOk) {
            console.log("  ✗ ERROR: Receive library mismatch!");
        }
        console.log("");

        // Check Berachain libraries
        console.log("--- Berachain OFT Library Configuration ---");
        address berachainCurrentSendLib = berachainEndpoint.getSendLibrary(berachainOftAddress, BASE_EID);
        (address berachainCurrentReceiveLib, bool berachainIsDefault) =
            berachainEndpoint.getReceiveLibrary(berachainOftAddress, BASE_EID);

        console.log("Expected Send Library:", berachainSendLib);
        console.log("Current Send Library:", berachainCurrentSendLib);
        bool berachainSendLibOk = berachainCurrentSendLib == berachainSendLib;
        console.log("Send Library Match:", berachainSendLibOk);
        if (!berachainSendLibOk) {
            console.log("  ✗ ERROR: Send library mismatch!");
        }

        console.log("Expected Receive Library:", berachainReceiveLib);
        console.log("Current Receive Library:", berachainCurrentReceiveLib);
        console.log("Is Default Library:", berachainIsDefault);
        bool berachainReceiveLibOk = berachainCurrentReceiveLib == berachainReceiveLib;
        console.log("Receive Library Match:", berachainReceiveLibOk);
        if (!berachainReceiveLibOk) {
            console.log("  ✗ ERROR: Receive library mismatch!");
        }
        console.log("");

        // Summary
        console.log("=== Verification Summary ===");
        bool allOk = basePeerSet && berachainPeerSet && baseSendLibOk && baseReceiveLibOk && berachainSendLibOk
            && berachainReceiveLibOk;

        if (allOk) {
            console.log("✓ All configurations are correct!");
            console.log("✓ Ready to bridge tokens");
        } else {
            console.log("✗ Some configurations are missing or incorrect");
            console.log("✗ Please fix the errors above before bridging");
        }
    }
}
