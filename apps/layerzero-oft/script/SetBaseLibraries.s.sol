// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title SetBaseLibraries
 * @notice Configures send and receive libraries for Base adapter
 * @dev Sets the libraries that the Base adapter will use for sending and receiving messages
 */
contract SetBaseLibraries is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    uint32 constant BERACHAIN_EID = 30362; // Berachain endpoint ID

    function run() public {
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address sendLib = vm.envAddress("BASE_SEND_LIB_ADDRESS");
        address receiveLib = vm.envAddress("BASE_RECEIVE_LIB_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IOAppCore adapter = IOAppCore(baseAdapterAddress);
        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        console.log("=== Configuring Base Adapter Libraries ===");
        console.log("Adapter Address:", baseAdapterAddress);
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

        // Set send library for Berachain destination
        console.log("Setting send library for Berachain (EID:", BERACHAIN_EID, ")...");
        endpoint.setSendLibrary(baseAdapterAddress, BERACHAIN_EID, sendLib);
        console.log("Send library set successfully");
        console.log("");

        // Set receive library for Berachain source
        console.log("Setting receive library for Berachain (EID:", BERACHAIN_EID, ")...");
        endpoint.setReceiveLibrary(baseAdapterAddress, BERACHAIN_EID, receiveLib, 0); // 0 grace period
        console.log("Receive library set successfully");
        console.log("");

        // Verify configuration
        address currentSendLib = endpoint.getSendLibrary(baseAdapterAddress, BERACHAIN_EID);
        (address currentReceiveLib, bool isDefault) = endpoint.getReceiveLibrary(baseAdapterAddress, BERACHAIN_EID);

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
