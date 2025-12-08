// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title ConfigureBaseDVNs
 * @notice Configures DVNs (Decentralized Verifier Networks) for Base adapter receive operations
 * @dev This configures which DVNs are required/optional for verifying incoming messages from Berachain
 *
 * IMPORTANT: This must be run AFTER deploying the adapter and setting up libraries.
 * DVN configuration is critical for receiving messages - without it, you'll get "DVN mismatch" errors.
 *
 * The script configures the receive library (ULN302) with:
 * - Required DVNs: LayerZero and Nethermind (from Berachain)
 * - Optional DVNs: None
 * - Confirmations: 1 (standard)
 */
contract ConfigureBaseDVNs is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    uint32 constant BERACHAIN_EID = 30362; // Berachain endpoint ID
    uint32 constant CONFIG_TYPE_ULN = 2; // ULN configuration type

    // UlnConfig structure (from UlnBase.sol)
    struct UlnConfig {
        uint64 confirmations;
        uint8 requiredDVNCount;
        uint8 optionalDVNCount;
        uint8 optionalDVNThreshold;
        address[] requiredDVNs;
        address[] optionalDVNs;
    }

    function run() public {
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address receiveLib = vm.envAddress("BASE_RECEIVE_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BERACHAIN_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BERACHAIN_NETHERMIND_DVN");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        console.log("=== Configuring Base Adapter DVNs ===");
        console.log("Adapter Address:", baseAdapterAddress);
        console.log("Receive Library:", receiveLib);
        console.log("Configuring for receiving from Berachain (EID:", BERACHAIN_EID, ")");
        console.log("");

        // Verify receive library is registered
        bool libRegistered = endpoint.isRegisteredLibrary(receiveLib);
        if (!libRegistered) {
            console.log("ERROR: Receive library is not registered!");
            vm.stopBroadcast();
            return;
        }
        console.log("[OK] Receive library is registered");
        console.log("");

        // Build required DVNs array (sorted ascending)
        address[] memory requiredDVNs = new address[](2);
        if (layerzeroDvn < nethermindDvn) {
            requiredDVNs[0] = layerzeroDvn;
            requiredDVNs[1] = nethermindDvn;
        } else {
            requiredDVNs[0] = nethermindDvn;
            requiredDVNs[1] = layerzeroDvn;
        }

        console.log("Required DVNs:");
        console.log("  - LayerZero DVN:", requiredDVNs[0]);
        console.log("  - Nethermind DVN:", requiredDVNs[1]);
        console.log("");

        // Create UlnConfig
        UlnConfig memory ulnConfig = UlnConfig({
            confirmations: 1, // Standard confirmations
            requiredDVNCount: 2,
            optionalDVNCount: 0, // No optional DVNs
            optionalDVNThreshold: 0,
            requiredDVNs: requiredDVNs,
            optionalDVNs: new address[](0)
        });

        // Encode the config
        bytes memory config = abi.encode(ulnConfig);

        // Create SetConfigParam
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BERACHAIN_EID, configType: CONFIG_TYPE_ULN, config: config});

        // Set the configuration
        console.log("Setting DVN configuration...");
        endpoint.setConfig(baseAdapterAddress, receiveLib, params);
        console.log("[OK] DVN configuration set successfully");
        console.log("");

        // Verify configuration
        bytes memory retrievedConfig =
            endpoint.getConfig(baseAdapterAddress, receiveLib, BERACHAIN_EID, CONFIG_TYPE_ULN);
        UlnConfig memory retrievedUlnConfig = abi.decode(retrievedConfig, (UlnConfig));

        console.log("=== Verification ===");
        console.log("Confirmations:", retrievedUlnConfig.confirmations);
        console.log("Required DVN Count:", retrievedUlnConfig.requiredDVNCount);
        console.log("Optional DVN Count:", retrievedUlnConfig.optionalDVNCount);
        console.log("");

        if (
            retrievedUlnConfig.requiredDVNCount == 2 && retrievedUlnConfig.requiredDVNs[0] == requiredDVNs[0]
                && retrievedUlnConfig.requiredDVNs[1] == requiredDVNs[1]
        ) {
            console.log("[OK] DVN configuration verified successfully");
        } else {
            console.log("[ERROR] DVN configuration mismatch!");
        }

        vm.stopBroadcast();
    }
}
