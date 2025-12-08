// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {UlnConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";

contract SetBerachainReceiveConfig is Script {
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID
    uint32 constant RECEIVE_CONFIG_TYPE = 2;

    function run() external {
        address oapp = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address receiveLib = vm.envAddress("BERACHAIN_RECEIVE_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BERACHAIN_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BERACHAIN_NETHERMIND_DVN");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

        console.log("Configuring Berachain receive settings (Berachain <- Base)");
        console.log("OApp:", oapp);
        console.log("Receive library:", receiveLib);
        console.log("Source EID:", BASE_EID);

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
            confirmations: 15,
            requiredDVNCount: 2,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: requiredDVNs,
            optionalDVNs: new address[](0)
        });

        bytes memory encodedUln = abi.encode(uln);

        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BASE_EID, configType: RECEIVE_CONFIG_TYPE, config: encodedUln});

        console.log("ULN config:");
        console.log("  Confirmations: 15");
        console.log("  Required DVNs: 2");

        endpoint.setConfig(oapp, receiveLib, params);
        console.log("Configuration set");

        bytes memory retrievedConfig = endpoint.getConfig(oapp, receiveLib, BASE_EID, RECEIVE_CONFIG_TYPE);
        if (retrievedConfig.length > 0) {
            UlnConfig memory retrievedUln = abi.decode(retrievedConfig, (UlnConfig));

            console.log("Verifying...");
            console.log("  Confirmations:", retrievedUln.confirmations);
            console.log("  Required DVNs:", retrievedUln.requiredDVNCount);
            console.log("  Optional DVNs:", retrievedUln.optionalDVNCount);

            if (
                retrievedUln.requiredDVNCount == 2 && retrievedUln.confirmations == 15
                    && retrievedUln.optionalDVNCount == 0 && retrievedUln.requiredDVNs[0] == requiredDVNs[0]
                    && retrievedUln.requiredDVNs[1] == requiredDVNs[1]
            ) {
                console.log("Configuration verified");
            } else {
                console.log("Configuration mismatch!");
            }
        }

        vm.stopBroadcast();
    }
}
