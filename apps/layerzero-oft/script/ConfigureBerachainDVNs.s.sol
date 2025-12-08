// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title ConfigureBerachainDVNs
 * @notice Configures DVNs (Decentralized Verifier Networks) for Berachain OFT receive operations
 * @dev This configures which DVNs are required/optional for verifying incoming messages from Base
 *
 * IMPORTANT: This must be run AFTER deploying the OFT and setting up libraries.
 * DVN configuration is critical for receiving messages - without it, you'll get "DVN mismatch" errors.
 *
 * The script configures the receive library (ULN302) with:
 * - Required DVNs: LayerZero and Nethermind (from Base)
 * - Optional DVNs: BERA DVN (optional)
 * - Confirmations: 1 (standard)
 */
contract ConfigureBerachainDVNs is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
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
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address receiveLib = vm.envAddress("BERACHAIN_RECEIVE_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BASE_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BASE_NETHERMIND_DVN");
        address optionalBeraDvn = vm.envAddress("BERACHAIN_OPTIONAL_BERA_DVN");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("=== Configuring Berachain OFT DVNs ===");
        console.log("OFT Address:", berachainOftAddress);
        console.log("Receive Library:", receiveLib);
        console.log("Configuring for receiving from Base (EID:", BASE_EID, ")");
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

        // Build optional DVNs array
        address[] memory optionalDVNs = new address[](1);
        optionalDVNs[0] = optionalBeraDvn;

        console.log("Required DVNs:");
        console.log("  - LayerZero DVN:", requiredDVNs[0]);
        console.log("  - Nethermind DVN:", requiredDVNs[1]);
        console.log("");
        console.log("Optional DVNs:");
        console.log("  - BERA DVN:", optionalDVNs[0]);
        console.log("");

        // Create UlnConfig
        UlnConfig memory ulnConfig = UlnConfig({
            confirmations: 1, // Standard confirmations
            requiredDVNCount: 2,
            optionalDVNCount: 1, // One optional DVN
            optionalDVNThreshold: 1, // Require at least 1 optional DVN
            requiredDVNs: requiredDVNs,
            optionalDVNs: optionalDVNs
        });

        // Encode the config
        bytes memory config = abi.encode(ulnConfig);

        // Create SetConfigParam
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BASE_EID, configType: CONFIG_TYPE_ULN, config: config});

        // Set the configuration
        console.log("Setting DVN configuration...");
        endpoint.setConfig(berachainOftAddress, receiveLib, params);
        console.log("[OK] DVN configuration set successfully");
        console.log("");

        // Verify configuration
        bytes memory retrievedConfig = endpoint.getConfig(berachainOftAddress, receiveLib, BASE_EID, CONFIG_TYPE_ULN);
        UlnConfig memory retrievedUlnConfig = abi.decode(retrievedConfig, (UlnConfig));

        console.log("=== Verification ===");
        console.log("Confirmations:", retrievedUlnConfig.confirmations);
        console.log("Required DVN Count:", retrievedUlnConfig.requiredDVNCount);
        console.log("Optional DVN Count:", retrievedUlnConfig.optionalDVNCount);
        console.log("Optional DVN Threshold:", retrievedUlnConfig.optionalDVNThreshold);
        console.log("");

        if (
            retrievedUlnConfig.requiredDVNCount == 2 && retrievedUlnConfig.optionalDVNCount == 1
                && retrievedUlnConfig.requiredDVNs[0] == requiredDVNs[0]
                && retrievedUlnConfig.requiredDVNs[1] == requiredDVNs[1]
        ) {
            console.log("[OK] DVN configuration verified successfully");
        } else {
            console.log("[ERROR] DVN configuration mismatch!");
        }

        vm.stopBroadcast();
    }
}
