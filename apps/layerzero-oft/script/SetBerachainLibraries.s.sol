// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title SetBerachainLibraries
 * @notice Configures send and receive libraries for Berachain OFT
 * @dev Sets the libraries that the Berachain OFT will use for sending and receiving messages
 */
contract SetBerachainLibraries is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)

    function run() public {
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address sendLib = vm.envAddress("BERACHAIN_SEND_LIB_ADDRESS");
        address receiveLib = vm.envAddress("BERACHAIN_RECEIVE_LIB_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IOAppCore oft = IOAppCore(berachainOftAddress);
        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("=== Configuring Berachain OFT Libraries ===");
        console.log("OFT Address:", berachainOftAddress);
        console.log("Send Library:", sendLib);
        console.log("Receive Library:", receiveLib);
        console.log("");

        // Verify libraries are registered
        bool sendLibRegistered = endpoint.isRegisteredLibrary(sendLib);
        bool receiveLibRegistered = endpoint.isRegisteredLibrary(receiveLib);

        console.log("Send Library Registered:", sendLibRegistered);
        console.log("Receive Library Registered:", receiveLibRegistered);
        console.log("");

        if (!sendLibRegistered) {
            console.log("WARNING: Send library is not registered!");
        }
        if (!receiveLibRegistered) {
            console.log("WARNING: Receive library is not registered!");
        }

        // Set send library for Base destination
        console.log("Setting send library for Base (EID:", BASE_EID, ")...");
        endpoint.setSendLibrary(berachainOftAddress, BASE_EID, sendLib);
        console.log("Send library set successfully");
        console.log("");

        // Set receive library for Base source
        console.log("Setting receive library for Base (EID:", BASE_EID, ")...");
        endpoint.setReceiveLibrary(berachainOftAddress, BASE_EID, receiveLib, 0); // 0 grace period
        console.log("Receive library set successfully");
        console.log("");

        // Verify configuration
        address currentSendLib = endpoint.getSendLibrary(berachainOftAddress, BASE_EID);
        (address currentReceiveLib, bool isDefault) = endpoint.getReceiveLibrary(berachainOftAddress, BASE_EID);

        console.log("=== Verification ===");
        console.log("Current Send Library:", currentSendLib);
        console.log("Current Receive Library:", currentReceiveLib);
        console.log("Is Default Receive Library:", isDefault);
        console.log("");

        if (currentSendLib == sendLib) {
            console.log("[OK] Send library configured correctly");
        } else {
            console.log("[ERROR] Send library mismatch!");
        }

        if (currentReceiveLib == receiveLib) {
            console.log("[OK] Receive library configured correctly");
        } else {
            console.log("[ERROR] Receive library mismatch!");
        }

        vm.stopBroadcast();
    }
}
