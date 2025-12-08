// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title GetBerachainLibraries
 * @notice Discovers default send and receive library addresses for Berachain
 * @dev Queries the Berachain LayerZero endpoint for default library configurations
 */
contract GetBerachainLibraries is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
    uint32 constant BERACHAIN_EID = 30362; // Berachain endpoint ID

    function run() public view {
        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("=== Berachain Library Discovery ===");
        console.log("Berachain Endpoint:", BERACHAIN_ENDPOINT);
        console.log("Berachain EID:", BERACHAIN_EID);
        console.log("");

        // Get default send library for Berachain
        address berachainSendLib = endpoint.defaultSendLibrary(BERACHAIN_EID);
        console.log("Berachain Default Send Library:", berachainSendLib);
        console.log("");

        // Get default receive library for Berachain
        address berachainReceiveLib = endpoint.defaultReceiveLibrary(BERACHAIN_EID);
        console.log("Berachain Default Receive Library:", berachainReceiveLib);
        console.log("");

        // Get send library for Base destination (from Berachain)
        address baseSendLib = endpoint.defaultSendLibrary(BASE_EID);
        console.log("Base Default Send Library (from Berachain):", baseSendLib);
        console.log("");

        // Get receive library for Base (from Berachain perspective)
        address baseReceiveLib = endpoint.defaultReceiveLibrary(BASE_EID);
        console.log("Base Default Receive Library (from Berachain):", baseReceiveLib);
        console.log("");

        console.log("=== Configuration Values ===");
        console.log("Add these to your .env file:");
        console.log("BERACHAIN_SEND_LIB_ADDRESS=", berachainSendLib);
        console.log("BERACHAIN_RECEIVE_LIB_ADDRESS=", berachainReceiveLib);
        console.log("BASE_SEND_LIB_ADDRESS=", baseSendLib);
        console.log("BASE_RECEIVE_LIB_ADDRESS=", baseReceiveLib);
    }
}
