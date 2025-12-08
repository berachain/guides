// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";

contract SetPeersBerachain is Script {
    uint32 constant BASE_EID = 30184; // Base endpoint ID

    function run() public {
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IOAppCore oft = IOAppCore(berachainOftAddress);

        console.log("Setting Berachain OFT peer");
        console.log("OFT:", berachainOftAddress);
        console.log("Base adapter:", baseAdapterAddress);
        console.log("Base EID:", BASE_EID);

        bytes32 peer = bytes32(uint256(uint160(baseAdapterAddress)));

        bytes32 currentPeer = oft.peers(BASE_EID);
        if (currentPeer != bytes32(0)) {
            address currentPeerAddress = address(uint160(uint256(currentPeer)));
            console.log("Current peer:", currentPeerAddress);
            if (currentPeerAddress == baseAdapterAddress) {
                console.log("Peer already configured");
            } else {
                console.log("Updating peer...");
            }
        } else {
            console.log("No peer set, configuring...");
        }

        oft.setPeer(BASE_EID, peer);
        console.log("Peer set");

        bytes32 verifiedPeer = oft.peers(BASE_EID);
        address verifiedPeerAddress = address(uint160(uint256(verifiedPeer)));

        console.log("Verifying...");
        console.log("Peer address:", verifiedPeerAddress);

        if (verifiedPeerAddress == baseAdapterAddress) {
            console.log("Peer configured correctly");
        } else {
            console.log("Peer mismatch!");
        }

        vm.stopBroadcast();
    }
}
