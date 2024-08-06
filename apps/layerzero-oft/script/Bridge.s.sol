pragma solidity ^0.8.22;

import "forge-std/Script.sol";
import {IOFT, SendParam} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {MessagingFee} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFTCore.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAdapter is IOAppCore, IOFT {}

// Bridge tokens from Sepolia to Berachain
contract SendOFTScript is Script {
    using OptionsBuilder for bytes;

    uint32 constant BERACHAIN_ENPOINT_ID = 40291;
    address constant SEPOLIA_WETH_ADDRESS =
        0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    function run() external {
        address SEPOLIA_ADAPTER_ADDRESS = vm.envAddress(
            "SEPOLIA_ADAPTER_ADDRESS"
        );
        address BERACHAIN_OFT_ADDRESS = vm.envAddress("BERACHAIN_OFT_ADDRESS");

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);
        address signer = vm.addr(privateKey);

        // Get the Adapter contract instance
        IAdapter sepoliaAdapter = IAdapter(SEPOLIA_ADAPTER_ADDRESS);

        // Hook up Sepolia Adapter to Berachain's OFT
        sepoliaAdapter.setPeer(
            BERACHAIN_ENPOINT_ID,
            bytes32(uint256(uint160(BERACHAIN_OFT_ADDRESS)))
        );

        // Define the send parameters
        uint256 tokensToSend = 0.0001 ether; // 0.0001 $UNI tokens

        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200000, 0);

        SendParam memory sendParam = SendParam(
            BERACHAIN_ENPOINT_ID,
            bytes32(uint256(uint160(signer))),
            tokensToSend,
            tokensToSend,
            options,
            "",
            ""
        );

        // Quote the send fee
        MessagingFee memory fee = sepoliaAdapter.quoteSend(sendParam, false);
        console.log("Native fee: %d", fee.nativeFee);

        // Approve the OFT contract to spend WETH tokens
        IERC20(SEPOLIA_WETH_ADDRESS).approve(
            SEPOLIA_ADAPTER_ADDRESS,
            tokensToSend
        );

        // Send the tokens
        sepoliaAdapter.send{value: fee.nativeFee}(sendParam, fee, signer);

        console.log("Tokens bridged successfully!");
    }
}
