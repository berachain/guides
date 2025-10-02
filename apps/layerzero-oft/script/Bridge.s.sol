// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOFT, SendParam} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {MessagingFee} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFTCore.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAdapter is IOAppCore, IOFT {}

// Bridge tokens from Base to Berachain
contract SendOFTScript is Script {
    using OptionsBuilder for bytes;

    uint32 constant BERACHAIN_ENDPOINT_ID = 30362; // Berachain mainnet endpoint ID

    function run() external {
        address baseTokenAddress = vm.envAddress("BASE_TOKEN_ADDRESS");
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        address berachainOftAddress = vm.envAddress("BERACHAIN_OFT_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);
        address signer = vm.addr(privateKey);

        console.log("Starting bridge from Base to Berachain...");
        console.log("Signer:", signer);
        console.log("Base Token:", baseTokenAddress);
        console.log("Base Adapter:", baseAdapterAddress);
        console.log("Berachain OFT:", berachainOftAddress);

        // Get the Adapter contract instance
        IAdapter baseAdapter = IAdapter(baseAdapterAddress);

        // Check if peer is already set
        bytes32 currentPeer = baseAdapter.peers(BERACHAIN_ENDPOINT_ID);
        if (currentPeer == bytes32(0)) {
            console.log("Setting peer connection...");
            // Hook up Base Adapter to Berachain's OFT
            baseAdapter.setPeer(
                BERACHAIN_ENDPOINT_ID,
                bytes32(uint256(uint160(berachainOftAddress)))
            );
            console.log("Peer connection established");
        } else {
            console.log("Peer already set:", uint256(currentPeer));
        }

        // Define the send parameters
        uint256 tokensToSend = 100 * 10**18; // 100 tokens (assuming 18 decimals)
        console.log("Amount to bridge:", tokensToSend);

        // Check token balance
        uint256 balance = IERC20(baseTokenAddress).balanceOf(signer);
        console.log("Current token balance:", balance);
        
        if (balance < tokensToSend) {
            console.log("ERROR: Insufficient token balance");
            vm.stopBroadcast();
            return;
        }

        // Create options with gas limit
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200000, 0);

        SendParam memory sendParam = SendParam(
            BERACHAIN_ENDPOINT_ID,
            bytes32(uint256(uint160(signer))),
            tokensToSend,
            tokensToSend,
            options,
            "",
            ""
        );

        // Quote the send fee
        MessagingFee memory fee = baseAdapter.quoteSend(sendParam, false);
        console.log("Native fee required:", fee.nativeFee);
        console.log("LZ token fee:", fee.lzTokenFee);

        // Check ETH balance for fees
        uint256 ethBalance = signer.balance;
        console.log("Current ETH balance:", ethBalance);
        
        if (ethBalance < fee.nativeFee) {
            console.log("ERROR: Insufficient ETH for fees");
            vm.stopBroadcast();
            return;
        }

        // Approve the OFT contract to spend custom tokens
        console.log("Approving tokens...");
        IERC20(baseTokenAddress).approve(
            baseAdapterAddress,
            tokensToSend
        );

        // Send the tokens
        console.log("Sending tokens...");
        baseAdapter.send{value: fee.nativeFee}(sendParam, fee, signer);

        console.log("Tokens bridged successfully from Base to Berachain!");
        console.log("Amount sent:", tokensToSend);
        console.log("Fee paid:", fee.nativeFee);
    }
}
