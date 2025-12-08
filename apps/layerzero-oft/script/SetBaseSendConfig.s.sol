// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {UlnConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import {ExecutorConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/SendLibBase.sol";

contract SetBaseSendConfig is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    uint32 constant BERACHAIN_EID = 30362;
    uint32 constant EXECUTOR_CONFIG_TYPE = 1;
    uint32 constant ULN_CONFIG_TYPE = 2;
    address constant BASE_EXECUTOR = 0x2CCA08ae69E0C44b18a57Ab2A87644234dAebaE4;

    function run() external {
        address oapp = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address sendLib = vm.envAddress("BASE_SEND_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BASE_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BASE_NETHERMIND_DVN");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        console.log("Configuring Base send settings (Base -> Berachain)");
        console.log("OApp:", oapp);
        console.log("Send library:", sendLib);
        console.log("Destination EID:", BERACHAIN_EID);

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

        ExecutorConfig memory exec = ExecutorConfig({maxMessageSize: 100000, executor: BASE_EXECUTOR});

        bytes memory encodedUln = abi.encode(uln);
        bytes memory encodedExec = abi.encode(exec);

        SetConfigParam[] memory params = new SetConfigParam[](2);
        params[0] = SetConfigParam({eid: BERACHAIN_EID, configType: EXECUTOR_CONFIG_TYPE, config: encodedExec});
        params[1] = SetConfigParam({eid: BERACHAIN_EID, configType: ULN_CONFIG_TYPE, config: encodedUln});

        console.log("Executor config:");
        console.log("  Max message size: 100000 bytes");
        console.log("  Executor:", BASE_EXECUTOR);
        console.log("ULN config:");
        console.log("  Confirmations: 20");
        console.log("  Required DVNs: 2");

        endpoint.setConfig(oapp, sendLib, params);
        console.log("Configuration set");

        bytes memory retrievedExecConfig = endpoint.getConfig(oapp, sendLib, BERACHAIN_EID, EXECUTOR_CONFIG_TYPE);
        bytes memory retrievedUlnConfig = endpoint.getConfig(oapp, sendLib, BERACHAIN_EID, ULN_CONFIG_TYPE);

        if (retrievedExecConfig.length > 0 && retrievedUlnConfig.length > 0) {
            ExecutorConfig memory retrievedExec = abi.decode(retrievedExecConfig, (ExecutorConfig));
            UlnConfig memory retrievedUln = abi.decode(retrievedUlnConfig, (UlnConfig));

            console.log("Verifying...");
            console.log("  Max message size:", retrievedExec.maxMessageSize);
            console.log("  Executor:", retrievedExec.executor);
            console.log("  Confirmations:", retrievedUln.confirmations);
            console.log("  Required DVNs:", retrievedUln.requiredDVNCount);

            if (
                retrievedExec.maxMessageSize == 100000 && retrievedUln.confirmations == 20
                    && retrievedUln.requiredDVNCount == 2
            ) {
                console.log("Configuration verified");
            } else {
                console.log("Configuration mismatch!");
            }
        }

        vm.stopBroadcast();
    }
}
