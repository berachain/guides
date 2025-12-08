// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import {Script, console} from "forge-std/Script.sol";
import {IOFT, SendParam, OFTReceipt} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
import {IOAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/interfaces/IOAppCore.sol";
import {MessagingFee, MessagingReceipt} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OAppSender.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAdapter is IOAppCore, IOFT {}

contract SendOFTScript is Script {
    using OptionsBuilder for bytes;

    uint32 constant BERACHAIN_ENDPOINT_ID = 30362; // Berachain mainnet endpoint ID

    function addressToBytes32(address _addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }

    function run() external {
        address baseTokenAddress = vm.envAddress("BASE_TOKEN_ADDRESS");
        address baseAdapterAddress = vm.envAddress("BASE_ADAPTER_ADDRESS");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);
        address signer = vm.addr(privateKey);

        address toAddress;
        try vm.envAddress("TO_ADDRESS") returns (address addr) {
            toAddress = addr;
        } catch {
            toAddress = signer;
        }

        uint256 tokensToSend;
        try vm.envUint("TOKENS_TO_SEND") returns (uint256 amount) {
            tokensToSend = amount;
        } catch {
            tokensToSend = 100 * 10 ** 18;
        }

        console.log("Bridging tokens from Base to Berachain");
        console.log("Signer:", signer);
        console.log("Token:", baseTokenAddress);
        console.log("Adapter:", baseAdapterAddress);
        console.log("Recipient:", toAddress);
        console.log("Amount:", tokensToSend);

        IAdapter baseAdapter = IAdapter(baseAdapterAddress);

        uint256 balance = IERC20(baseTokenAddress).balanceOf(signer);
        console.log("Token balance:", balance);

        if (balance < tokensToSend) {
            console.log("Insufficient token balance");
            vm.stopBroadcast();
            return;
        }

        bytes memory extraOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200000, 0);

        SendParam memory sendParam = SendParam({
            dstEid: BERACHAIN_ENDPOINT_ID,
            to: addressToBytes32(toAddress),
            amountLD: tokensToSend,
            minAmountLD: tokensToSend * 95 / 100,
            extraOptions: extraOptions,
            composeMsg: "",
            oftCmd: ""
        });

        MessagingFee memory fee = baseAdapter.quoteSend(sendParam, false);
        console.log("Fee estimate:", fee.nativeFee);

        uint256 ethBalance = signer.balance;
        console.log("ETH balance:", ethBalance);

        if (ethBalance < fee.nativeFee) {
            console.log("Insufficient ETH for fees");
            vm.stopBroadcast();
            return;
        }

        console.log("Approving tokens...");
        IERC20(baseTokenAddress).approve(baseAdapterAddress, tokensToSend);

        console.log("Sending...");
        (MessagingReceipt memory receipt, OFTReceipt memory oftReceipt) =
            baseAdapter.send{value: fee.nativeFee}(sendParam, fee, signer);

        console.log("Bridge successful!");
        console.log("GUID:", uint256(receipt.guid));
        console.log("Nonce:", receipt.nonce);
        console.log("Sent:", oftReceipt.amountSentLD);
        console.log("Received:", oftReceipt.amountReceivedLD);
        console.log("Fee:", fee.nativeFee);
    }
}
