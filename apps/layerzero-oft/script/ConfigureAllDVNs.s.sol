// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {
    IMessageLibManager,
    SetConfigParam
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";

/**
 * @title ConfigureAllDVNs
 * @notice Configures DVNs for both Base adapter and Berachain OFT in a single script
 * @dev This is a convenience script that configures both chains' DVN settings
 *
 * IMPORTANT: This script requires transactions on both chains.
 * You'll need to run it twice - once on each chain, or use a multi-chain setup.
 *
 * For Base: Run with --rpc-url https://mainnet.base.org
 * For Berachain: Run with --rpc-url https://rpc.berachain.com/
 */
contract ConfigureAllDVNs is Script {
    address constant BASE_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant BERACHAIN_ENDPOINT = 0x6F475642a6e85809B1c36Fa62763669b1b48DD5B;
    uint32 constant BASE_EID = 30184; // Base endpoint ID (corrected from 30110 which is Arbitrum)
    uint32 constant BERACHAIN_EID = 30362;
    uint32 constant CONFIG_TYPE_ULN = 2;

    struct UlnConfig {
        uint64 confirmations;
        uint8 requiredDVNCount;
        uint8 optionalDVNCount;
        uint8 optionalDVNThreshold;
        address[] requiredDVNs;
        address[] optionalDVNs;
    }

    function run() public {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        // Detect which chain we're on by checking if we can access Base endpoint
        bool isBase = block.chainid == 8453; // Base mainnet chain ID
        bool isBerachain = block.chainid == 80094; // Berachain mainnet chain ID

        if (isBase) {
            console.log("=== Configuring Base Adapter DVNs ===");
            _configureBaseDVNs();
        } else if (isBerachain) {
            console.log("=== Configuring Berachain OFT DVNs ===");
            _configureBerachainDVNs();
        } else {
            console.log("ERROR: Unknown chain. This script must be run on Base (8453) or Berachain (80094)");
            console.log("Current chain ID:", block.chainid);
            vm.stopBroadcast();
            return;
        }

        vm.stopBroadcast();
    }

    function _configureBaseDVNs() internal {
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address receiveLib = vm.envAddress("BASE_RECEIVE_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BERACHAIN_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BERACHAIN_NETHERMIND_DVN");

        IMessageLibManager endpoint = IMessageLibManager(BASE_ENDPOINT);

        // Build required DVNs array (sorted ascending)
        address[] memory requiredDVNs = new address[](2);
        if (layerzeroDvn < nethermindDvn) {
            requiredDVNs[0] = layerzeroDvn;
            requiredDVNs[1] = nethermindDvn;
        } else {
            requiredDVNs[0] = nethermindDvn;
            requiredDVNs[1] = layerzeroDvn;
        }

        UlnConfig memory ulnConfig = UlnConfig({
            confirmations: 1,
            requiredDVNCount: 2,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: requiredDVNs,
            optionalDVNs: new address[](0)
        });

        bytes memory config = abi.encode(ulnConfig);
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BERACHAIN_EID, configType: CONFIG_TYPE_ULN, config: config});

        console.log("Setting Base adapter DVN configuration...");
        endpoint.setConfig(baseAdapterAddress, receiveLib, params);
        console.log("[OK] Base adapter DVNs configured successfully");
    }

    function _configureBerachainDVNs() internal {
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address receiveLib = vm.envAddress("BERACHAIN_RECEIVE_LIB_ADDRESS");
        address layerzeroDvn = vm.envAddress("BASE_LAYERZERO_DVN");
        address nethermindDvn = vm.envAddress("BASE_NETHERMIND_DVN");
        address optionalBeraDvn = vm.envAddress("BERACHAIN_OPTIONAL_BERA_DVN");

        IMessageLibManager endpoint = IMessageLibManager(BERACHAIN_ENDPOINT);

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

        UlnConfig memory ulnConfig = UlnConfig({
            confirmations: 1,
            requiredDVNCount: 2,
            optionalDVNCount: 1,
            optionalDVNThreshold: 1,
            requiredDVNs: requiredDVNs,
            optionalDVNs: optionalDVNs
        });

        bytes memory config = abi.encode(ulnConfig);
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: BASE_EID, configType: CONFIG_TYPE_ULN, config: config});

        console.log("Setting Berachain OFT DVN configuration...");
        endpoint.setConfig(berachainOftAddress, receiveLib, params);
        console.log("[OK] Berachain OFT DVNs configured successfully");
    }
}
