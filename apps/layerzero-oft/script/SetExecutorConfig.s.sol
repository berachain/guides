// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title SetExecutorConfig
 * @notice Configures executor max message size for Base adapter send library
 * @dev OFT messages are 40 bytes (32 bytes address + 8 bytes amount), but default max is 32 bytes
 * This script sets the executor config to allow larger messages
 */
contract SetExecutorConfig is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    uint32 constant BERACHAIN_EID = 30362;
    uint32 constant CONFIG_TYPE_EXECUTOR = 1; // Executor configuration type

    // ExecutorConfig structure (from SendLibBase.sol)
    struct ExecutorConfig {
        uint32 maxMessageSize;
        address executor;
    }

    function run() public {
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address sendLib = vm.envAddress("BASE_SEND_LIB_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        console.log("=== Configuring Executor for Base Adapter ===");
        console.log("Adapter Address:", baseAdapterAddress);
        console.log("Send Library:", sendLib);
        console.log("Destination EID:", BERACHAIN_EID);
        console.log("");

        // Get default executor config from send library (using address(0) as oapp)
        // We'll import the send library interface to query it directly
        // For now, we know the default executor from Base is 0x2CCA08ae69E0C44b18a57Ab2A87644234dAebaE4

        // Get current config if it exists
        bytes memory currentConfig =
            endpoint.getConfig(baseAdapterAddress, sendLib, BERACHAIN_EID, CONFIG_TYPE_EXECUTOR);
        ExecutorConfig memory currentExecutorConfig;

        if (currentConfig.length > 0) {
            currentExecutorConfig = abi.decode(currentConfig, (ExecutorConfig));
            console.log("Current Executor:", currentExecutorConfig.executor);
            console.log("Current Max Message Size:", currentExecutorConfig.maxMessageSize);
        } else {
            console.log("No custom config found, will use default executor");
            currentExecutorConfig.executor = address(0); // 0 means use default
            currentExecutorConfig.maxMessageSize = 32; // Current custom limit
        }
        console.log("");

        // Set executor config with larger max message size
        // OFT messages are 40 bytes (32 bytes address + 8 bytes amount), so we set to 100 to be safe
        // Use explicit Base executor address
        address BASE_EXECUTOR = 0x2CCA08ae69E0C44b18a57Ab2A87644234dAebaE4;
        ExecutorConfig memory newConfig = ExecutorConfig({
            maxMessageSize: 100, // 100 bytes should be sufficient for OFT messages
            executor: BASE_EXECUTOR // Base executor address
        });

        bytes memory config = abi.encode(newConfig);
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BERACHAIN_EID, configType: CONFIG_TYPE_EXECUTOR, config: config});

        console.log("Setting executor configuration...");
        console.log("Max Message Size: 100 bytes");
        console.log("Executor:", BASE_EXECUTOR);
        console.log("");

        endpoint.setConfig(baseAdapterAddress, sendLib, params);
        console.log("[OK] Executor configuration set successfully");
        console.log("");

        // Verify configuration
        bytes memory retrievedConfig =
            endpoint.getConfig(baseAdapterAddress, sendLib, BERACHAIN_EID, CONFIG_TYPE_EXECUTOR);
        ExecutorConfig memory retrievedExecutorConfig = abi.decode(retrievedConfig, (ExecutorConfig));

        console.log("=== Verification ===");
        console.log("Max Message Size:", retrievedExecutorConfig.maxMessageSize);
        console.log("Executor:", retrievedExecutorConfig.executor);
        console.log("");

        if (retrievedExecutorConfig.maxMessageSize >= 40) {
            console.log("[OK] Executor configuration verified - can handle OFT messages (40 bytes)");
        } else {
            console.log("[ERROR] Max message size too small!");
        }

        vm.stopBroadcast();
    }
}
