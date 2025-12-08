// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title CheckExecutorConfig
 * @notice Checks executor configuration for both Base and Berachain
 */
contract CheckExecutorConfig is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    address constant BASE_EXECUTOR = 0x2CCA08ae69E0C44b18a57Ab2A87644234dAebaE4;
    address constant BERACHAIN_EXECUTOR = 0x4208D6E27538189bB48E603D6123A94b8Abe0A0b;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
    uint32 constant BERACHAIN_EID = 30362;
    uint32 constant CONFIG_TYPE_EXECUTOR = 1;

    struct ExecutorConfig {
        uint32 maxMessageSize;
        address executor;
    }

    function run() public view {
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address baseSendLib = vm.envAddress("BASE_SEND_LIB_ADDRESS");
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address berachainSendLib = vm.envAddress("BERACHAIN_SEND_LIB_ADDRESS");

        IMessageLibManager baseEndpoint = IMessageLibManager(BASE_ENDPOINT);
        IMessageLibManager berachainEndpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("=== Executor Configuration Check ===");
        console.log("");

        // Check Base executor
        console.log("1. Base Adapter Executor Configuration:");
        console.log("  Adapter:", baseAdapterAddress);
        console.log("  Send Library:", baseSendLib);
        console.log("  Destination EID (Berachain):", BERACHAIN_EID);
        console.log("  Expected Executor:", BASE_EXECUTOR);
        console.log("");

        bytes memory baseConfig =
            baseEndpoint.getConfig(baseAdapterAddress, baseSendLib, BERACHAIN_EID, CONFIG_TYPE_EXECUTOR);
        if (baseConfig.length > 0) {
            ExecutorConfig memory baseExecutorConfig = abi.decode(baseConfig, (ExecutorConfig));
            console.log("  Configured Executor:", baseExecutorConfig.executor);
            console.log("  Max Message Size:", baseExecutorConfig.maxMessageSize);
            if (baseExecutorConfig.executor == BASE_EXECUTOR) {
                console.log("  [OK] Executor matches expected address");
            } else {
                console.log("  [WARNING] Executor does not match expected address");
            }
        } else {
            console.log("  [ERROR] No executor config found!");
        }
        console.log("");

        // Check Berachain executor
        console.log("2. Berachain OFT Executor Configuration:");
        console.log("  OFT:", berachainOftAddress);
        console.log("  Send Library:", berachainSendLib);
        console.log("  Destination EID (Base):", BASE_EID);
        console.log("  Expected Executor:", BERACHAIN_EXECUTOR);
        console.log("");

        bytes memory berachainConfig =
            berachainEndpoint.getConfig(berachainOftAddress, berachainSendLib, BASE_EID, CONFIG_TYPE_EXECUTOR);
        if (berachainConfig.length > 0) {
            ExecutorConfig memory berachainExecutorConfig = abi.decode(berachainConfig, (ExecutorConfig));
            console.log("  Configured Executor:", berachainExecutorConfig.executor);
            console.log("  Max Message Size:", berachainExecutorConfig.maxMessageSize);
            if (berachainExecutorConfig.executor == BERACHAIN_EXECUTOR) {
                console.log("  [OK] Executor matches expected address");
            } else {
                console.log("  [WARNING] Executor does not match expected address");
            }
        } else {
            console.log("  [ERROR] No executor config found!");
        }
        console.log("");

        console.log("=== Check Complete ===");
        console.log("");
        console.log("Note: LayerZero Scan may show executor as empty [] if it's using");
        console.log("the default executor or if the executor is resolved dynamically.");
    }
}
