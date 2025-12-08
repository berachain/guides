// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";

contract SetPeersBase is Script {
    uint32 constant BERACHAIN_EID = 30362; // Berachain endpoint ID

    function run() public {
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        IOAppCore adapter = IOAppCore(baseAdapterAddress);

        console.log("Setting Base adapter peer");
        console.log("Adapter:", baseAdapterAddress);
        console.log("Berachain OFT:", berachainOftAddress);
        console.log("Berachain EID:", BERACHAIN_EID);

        bytes32 peer = bytes32(uint256(uint160(berachainOftAddress)));

        bytes32 currentPeer = adapter.peers(BERACHAIN_EID);
        if (currentPeer != bytes32(0)) {
            address currentPeerAddress = address(uint160(uint256(currentPeer)));
            console.log("Current peer:", currentPeerAddress);
            if (currentPeerAddress == berachainOftAddress) {
                console.log("Peer already configured");
            } else {
                console.log("Updating peer...");
            }
        } else {
            console.log("No peer set, configuring...");
        }

        adapter.setPeer(BERACHAIN_EID, peer);
        console.log("Peer set");

        bytes32 verifiedPeer = adapter.peers(BERACHAIN_EID);
        address verifiedPeerAddress = address(uint160(uint256(verifiedPeer)));

        console.log("Verifying...");
        console.log("Peer address:", verifiedPeerAddress);

        if (verifiedPeerAddress == berachainOftAddress) {
            console.log("Peer configured correctly");
        } else {
            console.log("Peer mismatch!");
        }

        vm.stopBroadcast();
    }
}
