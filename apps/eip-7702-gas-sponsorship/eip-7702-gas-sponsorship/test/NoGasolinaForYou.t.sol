// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, console2} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IHenlo, Henlo} from "../src/Henlo.sol";
import {NoGasolinaForYou} from "../src/NoGasolinaForYou.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice A foundry test using foundry cheat codes to properly simulate how EIP-7702 txs are set up and ran for gas sponsorship.
contract NoGasolinaForYouTest is Test {
    address payable constant EOA = payable(0x70997970C51812dc3A010C7d01b50e0d17dc79C8);
    uint256 constant EOA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address constant SPONSOR = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    event SponsoredHenlo(address indexed sponsor);

    Henlo public henlo;
    NoGasolinaForYou public implementation;

    function setUp() public {
        vm.deal(SPONSOR, 10 ether);
        vm.deal(EOA, 1 ether);

        henlo = new Henlo();
        implementation = new NoGasolinaForYou(address(henlo));

        // _simulateEIP7702Upgrade(EOA, address(implementation));
    }

    function testSponsoredSayHenlo() public {
        uint256 nonce = implementation.nonce();
        bytes32 digest = keccak256(abi.encodePacked(nonce, address(henlo)));
        bytes32 signed = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, signed);
        bytes memory signature = abi.encodePacked(r, s, v);

        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(implementation), EOA_PK);

        // uint256 sponsorBeraBefore = SPONSOR.balance;
        // uint256 eoaBefore = EOA.balance;

        vm.startPrank(SPONSOR);
        vm.attachDelegation(signedDelegation);

        // Verify that EOA's account now temporarily behaves as a smart contract.
        bytes memory code = address(EOA).code;
        require(code.length > 0, "no code written to EOA");
        // console2.log("Code on EOA's account:", vm.toString(code));

        // Expect the event. The first parameter should be SPONSOR.
        vm.expectEmit(true, true, true, true);
        emit SponsoredHenlo(SPONSOR);

        NoGasolinaForYou(EOA).sayHenlo(signature);

        // uint256 sponsorBeraAfter = SPONSOR.balance;
        // uint256 eoaAfter = EOA.balance;

        vm.stopPrank();

        // NOTE: Foundry does not currently showcase gas expenditures, and thus it will not show a change in the BERA gas token balance for these users even after the 7702 tx is broadcasted successfully. Keeping these commented out for now.
        // assertLt(sponsorBeraAfter, sponsorBeraBefore, "Sponsor should have paid gas"); 
        // assertEq(eoaAfter, eoaBefore, "EOA should not have paid gas");
    }

    function testInvalidSigReverts() public {
        uint256 nonce = implementation.nonce();
        bytes32 digest = keccak256(abi.encodePacked(nonce, address(henlo)));
        bytes32 signed = MessageHashUtils.toEthSignedMessageHash(digest);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, signed);
        bytes memory badSig = abi.encodePacked(r, s, v);

        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(implementation), EOA_PK);

        vm.startPrank(SPONSOR);
        vm.attachDelegation(signedDelegation);

        vm.expectRevert("Invalid signature");
        NoGasolinaForYou(EOA).sayHenlo(badSig);
    }

    function testReplayAttackFails() public {
        uint256 nonce = implementation.nonce();
        bytes32 digest = keccak256(abi.encodePacked(nonce, address(henlo)));
        bytes32 signed = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, signed);
        bytes memory signature = abi.encodePacked(r, s, v);

        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(implementation), EOA_PK);

        vm.startPrank(SPONSOR);
        vm.attachDelegation(signedDelegation);
        NoGasolinaForYou(EOA).sayHenlo(signature);

        vm.expectRevert("Invalid signature");
        NoGasolinaForYou(EOA).sayHenlo(signature);
    }

    /// Helpers

    // /// @dev this function is to instill future changes where foundry allows proper designation of implementation logic for EIP-7702 transactions to fully be executed. At the moment, without etch, 
    // function _simulateEIP7702Upgrade(address eoa, address logic) internal {
    //     // Once native EIP-7702 support is live, replace this with a clean runtime call.
    //     // vm.etch(eoa, logic.code);
    //     // vm.signAndAttachDelegation(implementation, EOA_PK);
    // }
}
