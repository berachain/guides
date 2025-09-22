// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {SimpleDelegatePart3} from "../src/SimpleDelegatePart3.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TestTokenContract
contract TestToken is ERC20 {
    constructor() ERC20("TestToken", "TTKN") {
        _mint(msg.sender, 1000e18);
    }
}

/// @dev Run script on Bepolia: `source .env && forge script script/SimpleDelegatePart3.s.sol:SimpleDelegate3Script --rpc-url $BEPOLIA_RPC_URL --broadcast -vvvv`
/// @dev Run script on anvil fork: `source .env && forge script script/SimpleDelegatePart3.s.sol:SimpleDelegate3Script --rpc-url $TEST_RPC_URL --broadcast -vvvv`
contract SimpleDelegate3Script is Script {
    address payable EOA;
    uint256 EOA_PK;
    address payable SPONSOR;
    uint256 SPONSOR_PK;
    SimpleDelegatePart3 public simpleDelegate;
    address TOKEN;
    uint256 constant TOKEN_TRANSFER_AMOUNT = 5e18;
    ERC20 public testToken;

    function run() public {
        EOA = payable(vm.envAddress("EOA_WALLET1_ADDRESS"));
        EOA_PK = vm.envUint("EOA_WALLET1_PK");
        SPONSOR = payable(vm.envAddress("SPONSOR_WALLET2_ADDRESS"));
        SPONSOR_PK = vm.envUint("SPONSOR_WALLET2_PK");

        vm.startBroadcast(EOA_PK);
        simpleDelegate = new SimpleDelegatePart3();
        testToken = new TestToken();
        vm.stopBroadcast();

        TOKEN = address(testToken);

        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(simpleDelegate), EOA_PK);

        uint256 burnAmount = 0.01 ether;
        uint256 transferAmount = burnAmount + 0.02 ether; // extra buffer for gas reimbursement
        uint256 nonce = simpleDelegate.getNonceToUse(vm.getNonce(EOA));

        console.log("Sponsor balance (wei):", SPONSOR.balance);
        require(SPONSOR.balance >= transferAmount, "Sponsor too poor for tx + value");

        SimpleDelegatePart3.Call memory call = SimpleDelegatePart3.Call({
            to: EOA,
            value: burnAmount,
            data: abi.encodeWithSelector(simpleDelegate.burnNative.selector)
        });

        bytes32 digest =
            keccak256(abi.encodePacked(block.chainid, call.to, call.value, keccak256(call.data), SPONSOR, nonce));
        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, ethSigned);
        bytes memory signature = abi.encodePacked(r, s, v);

        uint256 sponsorBefore = SPONSOR.balance;
        uint256 eoaBefore = EOA.balance;

        uint256 eoaTokenBefore = IERC20(TOKEN).balanceOf(EOA);
        uint256 sponsorTokenBefore = IERC20(TOKEN).balanceOf(SPONSOR);
        uint256 sponsorBalanceBefore = SPONSOR.balance;

        console.log("EOA token balance before:", eoaTokenBefore);
        console.log("Sponsor token balance before:", sponsorTokenBefore);
        console.log("Sponsor native balance before:", sponsorBalanceBefore);

        vm.startBroadcast(SPONSOR_PK);
        vm.attachDelegation(signedDelegation);

        bytes memory code = address(EOA).code;
        require(code.length > 0, "no code written to EOA");

        (bool success,) = EOA.call{value: transferAmount}(
            abi.encodeWithSelector(
                SimpleDelegatePart3.execute.selector, call, SPONSOR, nonce, signature, TOKEN, TOKEN_TRANSFER_AMOUNT
            )
        );
        require(success, "Call to EOA smart account failed");

        vm.stopBroadcast();

        uint256 eoaTokenAfter = IERC20(TOKEN).balanceOf(EOA);
        uint256 sponsorTokenAfter = IERC20(TOKEN).balanceOf(SPONSOR);
        uint256 sponsorBalanceAfter = SPONSOR.balance;

        console.log("EOA token balance after:", eoaTokenAfter);
        console.log("Sponsor token balance after:", sponsorTokenAfter);
        console.log("Sponsor native balance after:", sponsorBalanceAfter);

        uint256 sponsorAfter = SPONSOR.balance;
        uint256 eoaAfter = EOA.balance;

        uint256 sponsorDelta = sponsorBefore > sponsorAfter ? sponsorBefore - sponsorAfter : 0;

        uint256 actualReimbursement =
            sponsorAfter > (sponsorBefore - transferAmount) ? sponsorAfter - (sponsorBefore - transferAmount) : 0;

        uint256 eoaDelta = eoaAfter > eoaBefore ? eoaAfter - eoaBefore : 0;

        console.log("---- Execution Summary ----");
        console.log("Sponsor Gas Spent (wei):", sponsorDelta);
        console.log("EOA Delta (wei):", eoaDelta);
        console.log("Amount reimbursed to Sponsor (wei):", actualReimbursement);

        console.log("---- Test Case 1: Replay with Same Nonce ----");

        vm.startBroadcast(SPONSOR_PK);
        // vm.attachDelegation(signedDelegation);

        (bool replaySuccess,) = EOA.call{value: transferAmount}(
            abi.encodeWithSelector(SimpleDelegatePart3.execute.selector, call, SPONSOR, nonce, signature)
        );

        if (replaySuccess) {
            console.log("Replay succeeded unexpectedly (should have failed due to nonce reuse).");
        } else {
            console.log("");
        }

        vm.stopBroadcast();

        console.log("---- Test Case 2: Replay with Wrong ChainID ----");

        uint256 fakeChainId = 1; // Ethereum Mainnet

        bytes32 forgedDigest =
            keccak256(abi.encodePacked(fakeChainId, call.to, call.value, keccak256(call.data), SPONSOR, nonce));
        bytes32 forgedEthSigned = MessageHashUtils.toEthSignedMessageHash(forgedDigest);
        (uint8 fv, bytes32 fr, bytes32 fs) = vm.sign(EOA_PK, forgedEthSigned);
        bytes memory forgedSignature = abi.encodePacked(fr, fs, fv);

        vm.startBroadcast(SPONSOR_PK);
        // vm.attachDelegation(signedDelegation);

        (bool forgedSuccess,) = EOA.call{value: transferAmount}(
            abi.encodeWithSelector(SimpleDelegatePart3.execute.selector, call, SPONSOR, nonce, forgedSignature)
        );

        if (forgedSuccess) {
            console.log("Cross-chain replay succeeded unexpectedly (should have failed due to signature mismatch).");
        } else {
            console.log("Cross-chain replay failed as expected (invalid chainId in signature).");
        }

        vm.stopBroadcast();
    }
}
