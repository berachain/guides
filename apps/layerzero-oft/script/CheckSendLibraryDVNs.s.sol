// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title CheckSendLibraryDVNs
 * @notice Checks which DVNs the send library is configured to use
 */
contract CheckSendLibraryDVNs is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
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

        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        // Get the send library
        address sendLib = endpoint.getSendLibrary(baseAdapterAddress, BERACHAIN_EID);
        console.log("=== Base Send Library DVN Configuration ===");
        console.log("Adapter Address:", baseAdapterAddress);
        console.log("Send Library:", sendLib);
        console.log("Destination EID (Berachain):", BERACHAIN_EID);
        console.log("");

        // Check if send library has ULN config
        bytes memory config = endpoint.getConfig(baseAdapterAddress, sendLib, BERACHAIN_EID, CONFIG_TYPE_ULN);

        if (config.length == 0) {
            console.log("[INFO] No ULN config found for send library");
            console.log("This means the send library is using default DVNs");
            console.log("You may need to check the send library's default configuration");
        } else {
            UlnConfig memory ulnConfig = abi.decode(config, (UlnConfig));

            console.log("=== Send Library ULN Configuration ===");
            console.log("Confirmations:", ulnConfig.confirmations);
            console.log("Required DVN Count:", ulnConfig.requiredDVNCount);
            console.log("Optional DVN Count:", ulnConfig.optionalDVNCount);
            console.log("");

            console.log("=== Required DVNs (These must match Berachain receive config) ===");
            for (uint256 i = 0; i < ulnConfig.requiredDVNs.length; i++) {
                console.log("  DVN", i, ":", ulnConfig.requiredDVNs[i]);
            }
            console.log("");

            if (ulnConfig.optionalDVNs.length > 0) {
                console.log("=== Optional DVNs ===");
                for (uint256 i = 0; i < ulnConfig.optionalDVNs.length; i++) {
                    console.log("  DVN", i, ":", ulnConfig.optionalDVNs[i]);
                }
            }
        }
    }
}
