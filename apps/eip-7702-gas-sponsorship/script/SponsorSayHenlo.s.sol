// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "forge-std/Script.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Henlo} from "../src/Henlo.sol";
import {NoGasolinaForYou} from "../src/NoGasolinaForYou.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice A script to deploy the `Henlo.sol`, `NoGasolinaForYou.sol`, and carry out EIP-7702 txs showcasing gas sponsorship with the latter.
/// @dev Run script on Bepolia: `source .env && forge script script/SponsorSayHenlo.s.sol:SponsorSayHenlo --rpc-url $BEPOLIA_RPC_URL --with-gas-price 25000000000 --slow --broadcast`
/// @dev or RUN it on local fork of Bepolia, assuming you have ran `anvil --hardfork prague`, then run `source .env && forge script script/SponsorSayHenlo.s.sol:SponsorSayHenlo --rpc-url $TEST_RPC_URL --slow --broadcast`
/// @dev This script must be ran with a network that has been updated for EIP-7702 changes (ex. BECTRA on Bepolia)
contract SponsorSayHenlo is Script {

    address payable EOA;
    uint256 EOA_PK;
    address SPONSOR;
    uint256 SPONSOR_PK;

    function run() external {

        // Load from .env
        EOA = payable(vm.envAddress("EOA_ADDRESS"));
        EOA_PK = vm.envUint("EOA_PRIVATE_KEY");
        SPONSOR = vm.envAddress("SPONSOR_ADDRESS");
        SPONSOR_PK = vm.envUint("SPONSOR_PRIVATE_KEY");

        vm.startBroadcast(EOA_PK); 
        Henlo henlo = new Henlo();
        NoGasolinaForYou implementation = new NoGasolinaForYou(address(henlo));
        
        vm.stopBroadcast();

        // EOA signs a delegation allowing `implementation` to execute transactions on her behalf.
        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(implementation), EOA_PK);

        uint256 sponsorBeraBalanceBefore = SPONSOR.balance;
        uint256 eoaBeraBalanceBefore = EOA.balance;

        vm.startBroadcast(SPONSOR_PK);
        vm.attachDelegation(signedDelegation);

        // Verify that EOA's account now temporarily behaves as a smart contract.
        bytes memory code = address(EOA).code;
        require(code.length > 0, "no code written to EOA");

        uint256 nonce = implementation.nonce();
        bytes32 digest = keccak256(abi.encodePacked(nonce, address(henlo)));
        bytes32 signed = MessageHashUtils.toEthSignedMessageHash(digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, signed);
        bytes memory signature = abi.encodePacked(r, s, v);

        // As SPONSOR, execute the transaction via EOA's temporarily assigned contract.
        NoGasolinaForYou(EOA).sayHenlo(signature);

        vm.stopBroadcast();

        uint256 sponsorAfter = SPONSOR.balance;
        uint256 eoaBeraBalanceAfter = EOA.balance;

        console2.log("SPONSOR Balance Before:", sponsorBeraBalanceBefore);
        console2.log("SPONSOR Balance After:", sponsorAfter);
        console2.log("EOA Balance Before:", eoaBeraBalanceBefore);
        console2.log("EOA Balance After:", eoaBeraBalanceAfter);
    }
}
