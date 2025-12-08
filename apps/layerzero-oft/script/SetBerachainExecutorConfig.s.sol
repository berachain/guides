// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title SetBerachainExecutorConfig
 * @notice Configures executor for Berachain OFT send library
 * @dev Sets the executor address and max message size for Berachain
 */
contract SetBerachainExecutorConfig is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    address constant BERACHAIN_EXECUTOR = 0x4208D6E27538189bB48E603D6123A94b8Abe0A0b;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
    uint32 constant CONFIG_TYPE_EXECUTOR = 1; // Executor configuration type

    // ExecutorConfig structure (from SendLibBase.sol)
    struct ExecutorConfig {
        uint32 maxMessageSize;
        address executor;
    }

    function run() public {
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address sendLib = vm.envAddress("BERACHAIN_SEND_LIB_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("=== Configuring Executor for Berachain OFT ===");
        console.log("OFT Address:", berachainOftAddress);
        console.log("Send Library:", sendLib);
        console.log("Destination EID (Base):", BASE_EID);
        console.log("");

        // Get current config if it exists
        bytes memory currentConfig = endpoint.getConfig(berachainOftAddress, sendLib, BASE_EID, CONFIG_TYPE_EXECUTOR);
        ExecutorConfig memory currentExecutorConfig;

        if (currentConfig.length > 0) {
            currentExecutorConfig = abi.decode(currentConfig, (ExecutorConfig));
            console.log("Current Executor:", currentExecutorConfig.executor);
            console.log("Current Max Message Size:", currentExecutorConfig.maxMessageSize);
        } else {
            console.log("No custom config found, will set new executor");
        }
        console.log("");

        // Set executor config with larger max message size
        // OFT messages are 40 bytes (32 bytes address + 8 bytes amount), so we set to 100 to be safe
        ExecutorConfig memory newConfig = ExecutorConfig({
            maxMessageSize: 100, // 100 bytes should be sufficient for OFT messages
            executor: BERACHAIN_EXECUTOR // Berachain executor address
        });

        bytes memory config = abi.encode(newConfig);
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BASE_EID, configType: CONFIG_TYPE_EXECUTOR, config: config});

        console.log("Setting executor configuration...");
        console.log("Max Message Size: 100 bytes");
        console.log("Executor:", BERACHAIN_EXECUTOR);
        console.log("");

        endpoint.setConfig(berachainOftAddress, sendLib, params);
        console.log("[OK] Executor configuration set successfully");
        console.log("");

        // Verify configuration
        bytes memory retrievedConfig = endpoint.getConfig(berachainOftAddress, sendLib, BASE_EID, CONFIG_TYPE_EXECUTOR);
        ExecutorConfig memory retrievedExecutorConfig = abi.decode(retrievedConfig, (ExecutorConfig));

        console.log("=== Verification ===");
        console.log("Max Message Size:", retrievedExecutorConfig.maxMessageSize);
        console.log("Executor:", retrievedExecutorConfig.executor);
        console.log("");

        if (retrievedExecutorConfig.maxMessageSize >= 40 && retrievedExecutorConfig.executor == BERACHAIN_EXECUTOR) {
            console.log("[OK] Executor configuration verified - can handle OFT messages (40 bytes)");
        } else {
            console.log("[ERROR] Executor configuration mismatch!");
        }

        vm.stopBroadcast();
    }
}
