// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./Henlo.sol"; // assumes Henlo is in same directory; update if needed

/// @title NoGasolinaForYou Educational Contract
/// @notice An example implementation contract representing "guard-railed" transactions with gas sponsorship leveraging EIP-7702
/// @dev Implementation contracts that become authorized delegate addresses for Smart Accounts (EOAs using 7702) ought to abide by typical smart contract design practices, and more, since they now bring in new attack vectors upon EOAs. This example implementation contract purposely only prepares transactions for a downstream contract, `Henlo.sol`, to showcase writing implementation contracts as a dApp that EOAs can point to for dApp-bespoke transactions. This is the alternative vs doing low level, arbitrary calls for example.
contract NoGasolinaForYou {
    using ECDSA for bytes32;

    uint256 public nonce;
    address public immutable henloAddress;

    event SponsoredHenlo(address indexed sponsor);

    constructor(address _henloAddress) {
        henloAddress = _henloAddress;
    }

    function sayHenlo(bytes calldata signature) external payable {
        bytes32 digest = keccak256(abi.encodePacked(nonce, henloAddress));
        bytes32 ethSignedDigest = MessageHashUtils.toEthSignedMessageHash(digest);

        address recovered = ECDSA.recover(ethSignedDigest, signature);
        require(recovered == address(this), "Invalid signature");

        nonce++;
        IHenlo(henloAddress).sayHenlo();
        emit SponsoredHenlo(msg.sender);
    }

    function sayHenlo() external {
        require(msg.sender == address(this), "Only self-call allowed");
        nonce++;
        IHenlo(henloAddress).sayHenlo();
        emit SponsoredHenlo(msg.sender);
    }

    fallback() external payable {}
    receive() external payable {}
}
