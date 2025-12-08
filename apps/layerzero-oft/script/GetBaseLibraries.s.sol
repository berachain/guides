// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title GetBaseLibraries
 * @notice Discovers default send and receive library addresses for Base
 * @dev Queries the Base LayerZero endpoint for default library configurations
 */
contract GetBaseLibraries is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    uint32 constant BASE_EID = 30110; // Base endpoint ID
    uint32 constant BERACHAIN_EID = 30362; // Berachain endpoint ID

    function run() public view {
        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        console.log("=== Base Library Discovery ===");
        console.log("Base Endpoint:", BASE_ENDPOINT);
        console.log("Base EID:", BASE_EID);
        console.log("");

        // Get default send library for Base
        address baseSendLib = endpoint.defaultSendLibrary(BASE_EID);
        console.log("Base Default Send Library:", baseSendLib);
        console.log("");

        // Get default receive library for Base
        address baseReceiveLib = endpoint.defaultReceiveLibrary(BASE_EID);
        console.log("Base Default Receive Library:", baseReceiveLib);
        console.log("");

        // Get send library for Berachain destination (from Base)
        address berachainSendLib = endpoint.defaultSendLibrary(BERACHAIN_EID);
        console.log("Berachain Default Send Library (from Base):", berachainSendLib);
        console.log("");

        // Get receive library for Berachain (from Base perspective)
        address berachainReceiveLib = endpoint.defaultReceiveLibrary(BERACHAIN_EID);
        console.log("Berachain Default Receive Library (from Base):", berachainReceiveLib);
        console.log("");

        console.log("=== Configuration Values ===");
        console.log("Add these to your .env file:");
        console.log("BASE_SEND_LIB_ADDRESS=", baseSendLib);
        console.log("BASE_RECEIVE_LIB_ADDRESS=", baseReceiveLib);
        console.log("BERACHAIN_SEND_LIB_ADDRESS=", berachainSendLib);
        console.log("BERACHAIN_RECEIVE_LIB_ADDRESS=", berachainReceiveLib);
    }
}
