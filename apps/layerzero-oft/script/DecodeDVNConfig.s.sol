// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title DecodeDVNConfig
 * @notice Decodes and displays the full ULN configuration including DVN addresses
 */
contract DecodeDVNConfig is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
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
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address receiveLib = vm.envAddress("BERACHAIN_RECEIVE_LIB_ADDRESS");

        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("=== Decoding Berachain OFT ULN Config ===");
        console.log("OFT Address:", berachainOftAddress);
        console.log("Receive Library:", receiveLib);
        console.log("Remote EID (Base):", BASE_EID);
        console.log("");

        bytes memory config = endpoint.getConfig(berachainOftAddress, receiveLib, BASE_EID, CONFIG_TYPE_ULN);

        if (config.length == 0) {
            console.log("[ERROR] No ULN config found!");
            return;
        }

        UlnConfig memory ulnConfig = abi.decode(config, (UlnConfig));

        console.log("=== ULN Configuration ===");
        console.log("Confirmations:", ulnConfig.confirmations);
        console.log("Required DVN Count:", ulnConfig.requiredDVNCount);
        console.log("Optional DVN Count:", ulnConfig.optionalDVNCount);
        console.log("Optional DVN Threshold:", ulnConfig.optionalDVNThreshold);
        console.log("");

        console.log("=== Required DVNs ===");
        for (uint256 i = 0; i < ulnConfig.requiredDVNs.length; i++) {
            console.log("  DVN", i, ":", ulnConfig.requiredDVNs[i]);
        }
        console.log("");

        console.log("=== Optional DVNs ===");
        for (uint256 i = 0; i < ulnConfig.optionalDVNs.length; i++) {
            console.log("  DVN", i, ":", ulnConfig.optionalDVNs[i]);
        }
        console.log("");

        console.log("=== Expected DVNs from LayerZero Scan ===");
        console.log("  LayerZero Labs: 0x70bcf6bbcb0a5128b2fe440174b8...");
        console.log("  Nethermind: 0xc81e9bb3319e7938d780c4c59b6...");
        console.log("");
        console.log("Compare the configured DVNs above with the expected ones from LayerZero Scan.");
    }
}
