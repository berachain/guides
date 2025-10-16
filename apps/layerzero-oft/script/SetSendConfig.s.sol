// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Script } from "forge-std/Script.sol";
import { IMessageLibManager, SetConfigParam } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import { UlnConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import { ExecutorConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/SendLibBase.sol";

/// @title LayerZero Send Configuration Script (A → B)
/// @notice Defines and applies ULN (DVN) + Executor configs for cross‑chain messages sent from Chain A to Chain B via LayerZero Endpoint V2.
contract SetSendConfig is Script {
    uint32 constant EXECUTOR_CONFIG_TYPE = 1;
    uint32 constant ULN_CONFIG_TYPE = 2;

     /// @notice Broadcasts transactions to set both Send ULN and Executor configurations for messages sent from Chain A to Chain B
    function run() external {
        address endpoint = vm.envAddress("SOURCE_ENDPOINT_ADDRESS"); // Chain A Endpoint
        address oapp      = vm.envAddress("SENDER_OAPP_ADDRESS");    // OApp on Chain A
        uint32 eid        = uint32(vm.envUint("REMOTE_EID"));        // Endpoint ID for Chain B
        address sendLib   = vm.envAddress("SEND_LIB_ADDRESS");      // SendLib for A → B
        address signer    = vm.envAddress("SIGNER");

        /// @notice ULNConfig defines security parameters (DVNs + confirmation threshold) for A → B
        /// @notice Send config requests these settings to be applied to the DVNs and Executor for messages sent from A to B
        /// @dev 0 values will be interpretted as defaults, so to apply NIL settings, use:
        /// @dev uint8 internal constant NIL_DVN_COUNT = type(uint8).max;
        /// @dev uint64 internal constant NIL_CONFIRMATIONS = type(uint64).max;
        UlnConfig memory uln = UlnConfig({
            confirmations:        15,                                      // minimum block confirmations required on A before sending to B
            requiredDVNCount:     2,                                       // number of DVNs required
            optionalDVNCount:     type(uint8).max,                         // optional DVNs count, uint8
            optionalDVNThreshold: 0,                                       // optional DVN threshold
            requiredDVNs:        createDVNArray(), // sorted list of required DVN addresses
            optionalDVNs:        new address[](0)                        // sorted list of optional DVNs
        });

        /// @notice ExecutorConfig sets message size limit + fee‑paying executor for A → B
        ExecutorConfig memory exec = ExecutorConfig({
            maxMessageSize: 10000,                                       // max bytes per cross-chain message
            executor:       address(0x3333333333333333333333333333333333333333)                           // address that pays destination execution fees on B
        });

        bytes memory encodedUln  = abi.encode(uln);
        bytes memory encodedExec = abi.encode(exec);

        SetConfigParam[] memory params = new SetConfigParam[](2);
        params[0] = SetConfigParam(eid, EXECUTOR_CONFIG_TYPE, encodedExec);
        params[1] = SetConfigParam(eid, ULN_CONFIG_TYPE, encodedUln);

        vm.startBroadcast(signer);
        IMessageLibManager(endpoint).setConfig(oapp, sendLib, params); // Set config for messages sent from A to B
        vm.stopBroadcast();
    }

    function createDVNArray() internal pure returns (address[] memory) {
        address[] memory dvns = new address[](2);
        dvns[0] = address(0x1111111111111111111111111111111111111111);
        dvns[1] = address(0x2222222222222222222222222222222222222222);
        return dvns;
    }
}
