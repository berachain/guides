// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {SimpleDelegatePart2} from "../src/SimpleDelegatePart2.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Vm} from "forge-std/Vm.sol";


/// @dev Run script on Bepolia: `source .env && forge script script/SimpleDelegatePart2.s.sol:SimpleDelegate2Script --rpc-url $BEPOLIA_RPC_URL --broadcast -vvvv`
/// @dev Run script on anvil fork: `source .env && forge script script/SimpleDelegatePart2.s.sol:SimpleDelegate2Script --rpc-url $TEST_RPC_URL --broadcast -vvvv`
contract SimpleDelegate2Script is Script {
    address payable EOA;
    uint256 EOA_PK;
    address payable SPONSOR;
    uint256 SPONSOR_PK;
    SimpleDelegatePart2 public simpleDelegate;

    function run() public {
        EOA = payable(vm.envAddress("EOA_WALLET1_ADDRESS"));
        EOA_PK = vm.envUint("EOA_WALLET1_PK");
        SPONSOR = payable(vm.envAddress("SPONSOR_WALLET2_ADDRESS"));
        SPONSOR_PK = vm.envUint("SPONSOR_WALLET2_PK");

        vm.startBroadcast(EOA_PK);
        simpleDelegate = new SimpleDelegatePart2();
        vm.stopBroadcast();

        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(simpleDelegate), EOA_PK);

        uint256 burnAmount = 0.01 ether;
        uint256 transferAmount = burnAmount + 0.02 ether; // extra buffer for gas reimbursement
        uint256 nonce = simpleDelegate.getNonceToUse(vm.getNonce(EOA));

        console.log("Sponsor balance (wei):", SPONSOR.balance);
        require(
            SPONSOR.balance >= transferAmount,
            "Sponsor too poor for tx + value"
        );

        SimpleDelegatePart2.Call memory call = SimpleDelegatePart2.Call({
            to: EOA,
            value: burnAmount,
            data: abi.encodeWithSelector(simpleDelegate.burnNative.selector)
        });

        bytes32 digest = keccak256(
            abi.encodePacked(block.chainid, call.to, call.value, keccak256(call.data), SPONSOR, nonce)
        );
        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, ethSigned);
        bytes memory signature = abi.encodePacked(r, s, v);


        uint256 sponsorBefore = SPONSOR.balance;
        uint256 eoaBefore = EOA.balance;

        vm.startBroadcast(SPONSOR_PK);
        vm.attachDelegation(signedDelegation);

        bytes memory code = address(EOA).code;
        require(code.length > 0, "no code written to EOA");

        (bool success, ) = EOA.call{value: transferAmount}(
            abi.encodeWithSelector(
                SimpleDelegatePart2.execute.selector,
                call,
                SPONSOR,
                nonce,
                signature
            )
        );
        require(success, "Call to EOA smart account failed");

        vm.stopBroadcast();

        uint256 sponsorAfter = SPONSOR.balance;
        uint256 eoaAfter = EOA.balance;

        uint256 sponsorDelta = sponsorBefore > sponsorAfter
            ? sponsorBefore - sponsorAfter
            : 0;

        uint256 actualReimbursement = sponsorAfter > (sponsorBefore - transferAmount)
            ? sponsorAfter - (sponsorBefore - transferAmount)
            : 0;

        uint256 eoaDelta = eoaAfter > eoaBefore
            ? eoaAfter - eoaBefore
            : 0;

        console.log("---- Execution Summary ----");
        console.log("Sponsor Gas Spent (wei):", sponsorDelta);
        console.log("EOA Delta (wei):", eoaDelta);
        console.log("Amount reimbursed to Sponsor (wei):", actualReimbursement);

        console.log("---- Test Case 1: Replay with Same Nonce ----");

        vm.startBroadcast(SPONSOR_PK);
        // vm.attachDelegation(signedDelegation);

        (bool replaySuccess, ) = EOA.call{value: transferAmount}(
            abi.encodeWithSelector(
                SimpleDelegatePart2.execute.selector,
                call,
                SPONSOR,
                nonce,
                signature
            )
        );

        if (replaySuccess) {
            console.log("Replay succeeded unexpectedly (should have failed due to nonce reuse).");
        } else {
            console.log("");
        }

        vm.stopBroadcast();

                console.log("---- Test Case 2: Replay with Wrong ChainID ----");

        uint256 fakeChainId = 1; // Ethereum Mainnet

        bytes32 forgedDigest = keccak256(
            abi.encodePacked(fakeChainId, call.to, call.value, keccak256(call.data), SPONSOR, nonce)
        );
        bytes32 forgedEthSigned = MessageHashUtils.toEthSignedMessageHash(forgedDigest);
        (uint8 fv, bytes32 fr, bytes32 fs) = vm.sign(EOA_PK, forgedEthSigned);
        bytes memory forgedSignature = abi.encodePacked(fr, fs, fv);

        vm.startBroadcast(SPONSOR_PK);
        // vm.attachDelegation(signedDelegation);

        (bool forgedSuccess, ) = EOA.call{value: transferAmount}(
            abi.encodeWithSelector(
                SimpleDelegatePart2.execute.selector,
                call,
                SPONSOR,
                nonce,
                forgedSignature
            )
        );

        if (forgedSuccess) {
            console.log("Cross-chain replay succeeded unexpectedly (should have failed due to signature mismatch).");
        } else {
            console.log("Cross-chain replay failed as expected (invalid chainId in signature).");
        }

        vm.stopBroadcast();



    }
}