// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Script } from "forge-std/Script.sol";
import { IMessageLibManager, SetConfigParam } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import { UlnConfig } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";

/// @title LayerZero Receive Configuration Script (B ← A)
/// @notice Defines and applies ULN (DVN) config for inbound message verification on Chain B for messages received from Chain A via LayerZero Endpoint V2.
contract SetReceiveConfig is Script {
    uint32 constant RECEIVE_CONFIG_TYPE = 2;

    function run() external {
        address endpoint = vm.envAddress("ENDPOINT_ADDRESS");      // Chain B Endpoint
        address oapp      = vm.envAddress("OAPP_ADDRESS");         // OApp on Chain B
        uint32 eid        = uint32(vm.envUint("REMOTE_EID"));      // Endpoint ID for Chain A
        address receiveLib= vm.envAddress("RECEIVE_LIB_ADDRESS");  // ReceiveLib for B ← A
        address signer    = vm.envAddress("SIGNER");

        /// @notice UlnConfig controls verification threshold for incoming messages from A to B
        /// @notice Receive config enforces these settings have been applied to the DVNs for messages received from A
        /// @dev 0 values will be interpretted as defaults, so to apply NIL settings, use:
        /// @dev uint8 internal constant NIL_DVN_COUNT = type(uint8).max;
        /// @dev uint64 internal constant NIL_CONFIRMATIONS = type(uint64).max;
        UlnConfig memory uln = UlnConfig({
            confirmations:      15,                                       // min block confirmations from source (A)
            requiredDVNCount:   2,                                        // required DVNs for message acceptance
            optionalDVNCount:   type(uint8).max,                          // optional DVNs count
            optionalDVNThreshold: 0,                                      // optional DVN threshold
            requiredDVNs:       createDVNArray(), // sorted required DVNs
            optionalDVNs:       new address[](0)                         // no optional DVNs
        });

        bytes memory encodedUln = abi.encode(uln);

        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam(eid, RECEIVE_CONFIG_TYPE, encodedUln);

        vm.startBroadcast(signer);
        IMessageLibManager(endpoint).setConfig(oapp, receiveLib, params); // Set config for messages received on B from A
        vm.stopBroadcast();
    }

    function createDVNArray() internal pure returns (address[] memory) {
        address[] memory dvns = new address[](2);
        dvns[0] = address(0x1111111111111111111111111111111111111111);
        dvns[1] = address(0x2222222222222222222222222222222222222222);
        return dvns;
    }
}
