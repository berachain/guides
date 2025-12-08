// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {UlnConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import {ExecutorConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/SendLibBase.sol";

contract SetBerachainSendConfig is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID
    uint32 constant EXECUTOR_CONFIG_TYPE = 1;
    uint32 constant ULN_CONFIG_TYPE = 2;
    address constant BERACHAIN_EXECUTOR = 0x4208D6E27538189bB48E603D6123A94b8Abe0A0b;

    /// @notice Broadcasts transactions to set both Send ULN and Executor configurations for messages sent from Berachain to Base
    function run() external {
        address oapp = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address sendLib = vm.envAddress("BERACHAIN_SEND_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BERACHAIN_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BERACHAIN_NETHERMIND_DVN");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("Configuring Berachain send settings (Berachain -> Base)");
        console.log("OApp:", oapp);
        console.log("Send library:", sendLib);
        console.log("Destination EID:", BASE_EID);

        address[] memory requiredDVNs = new address[](2);
        if (layerzeroDvn < nethermindDvn) {
            requiredDVNs[0] = layerzeroDvn;
            requiredDVNs[1] = nethermindDvn;
        } else {
            requiredDVNs[0] = nethermindDvn;
            requiredDVNs[1] = layerzeroDvn;
        }

        console.log("Required DVNs:");
        console.log("  LayerZero:", requiredDVNs[0]);
        console.log("  Nethermind:", requiredDVNs[1]);

        UlnConfig memory uln = UlnConfig({
            confirmations: 20,
            requiredDVNCount: 2,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: requiredDVNs,
            optionalDVNs: new address[](0)
        });

        ExecutorConfig memory exec = ExecutorConfig({maxMessageSize: 100000, executor: BERACHAIN_EXECUTOR});

        bytes memory encodedUln = abi.encode(uln);
        bytes memory encodedExec = abi.encode(exec);

        SetConfigParam[] memory params = new SetConfigParam[](2);
        params[0] = SetConfigParam({eid: BASE_EID, configType: EXECUTOR_CONFIG_TYPE, config: encodedExec});
        params[1] = SetConfigParam({eid: BASE_EID, configType: ULN_CONFIG_TYPE, config: encodedUln});

        console.log("Executor config:");
        console.log("  Max message size: 100000 bytes");
        console.log("  Executor:", BERACHAIN_EXECUTOR);
        console.log("ULN config:");
        console.log("  Confirmations: 20");
        console.log("  Required DVNs: 2");

        endpoint.setConfig(oapp, sendLib, params);
        console.log("Configuration set");

        bytes memory retrievedExecConfig = endpoint.getConfig(oapp, sendLib, BASE_EID, EXECUTOR_CONFIG_TYPE);
        bytes memory retrievedUlnConfig = endpoint.getConfig(oapp, sendLib, BASE_EID, ULN_CONFIG_TYPE);

        if (retrievedExecConfig.length > 0 && retrievedUlnConfig.length > 0) {
            ExecutorConfig memory retrievedExec = abi.decode(retrievedExecConfig, (ExecutorConfig));
            UlnConfig memory retrievedUln = abi.decode(retrievedUlnConfig, (UlnConfig));

            console.log("Verifying...");
            console.log("  Max message size:", retrievedExec.maxMessageSize);
            console.log("  Executor:", retrievedExec.executor);
            console.log("  Confirmations:", retrievedUln.confirmations);
            console.log("  Required DVNs:", retrievedUln.requiredDVNCount);
            console.log("  Optional DVNs:", retrievedUln.optionalDVNCount);

            if (
                retrievedExec.maxMessageSize == 100000 && retrievedUln.confirmations == 20
                    && retrievedUln.requiredDVNCount == 2 && retrievedUln.optionalDVNCount == 0
            ) {
                console.log("Configuration verified");
            } else {
                console.log("Configuration mismatch!");
            }
        }

        vm.stopBroadcast();
    }
}
