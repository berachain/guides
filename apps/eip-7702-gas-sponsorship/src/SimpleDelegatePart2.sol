// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract SimpleDelegatePart2 {
    using ECDSA for bytes32;

    struct Call {
        bytes data;
        address to;
        uint256 value;
    }

    mapping(uint256 => bool) public nonceUsed;

    error ExternalCallFailed();
    error ReimbursementFailed();
    error InvalidSignature();
    error NonceAlreadyUsed();

    event HenloSaid(address indexed sender, address indexed eoa, string message);
    event Reimbursed(address indexed sponsor, uint256 refund);
    event Burned(address indexed from, uint256 amount);

    function execute(Call memory userCall, address sponsor, uint256 nonce, bytes calldata signature) external payable {
        uint256 startGas = gasleft();

        bytes32 digest = keccak256(
            abi.encodePacked(block.chainid, userCall.to, userCall.value, keccak256(userCall.data), sponsor, nonce)
        );
        address recovered = MessageHashUtils.toEthSignedMessageHash(digest).recover(signature);
        require(recovered == address(this), "Invalid signer");

        if (nonceUsed[nonce]) revert NonceAlreadyUsed();
        nonceUsed[nonce] = true;

        (bool success,) = userCall.to.call{value: userCall.value}(userCall.data);
        if (!success) revert ExternalCallFailed();

        uint256 gasUsed = startGas - gasleft();
        uint256 gasCost = gasUsed * tx.gasprice;
        uint256 refund = msg.value > gasCost ? msg.value - gasCost : 0;

        if (refund > 0) {
            (bool refunded,) = sponsor.call{value: refund}("");
            require(refunded, ReimbursementFailed());
            emit Reimbursed(sponsor, refund);
        }

        emit HenloSaid(msg.sender, recovered, "Henlo triggered!");
    }

    function burnNative() external payable {
        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        (bool sent,) = burnAddr.call{value: msg.value}("");
        require(sent, "Burn failed");
        emit Burned(msg.sender, msg.value);
    }

    function getNonceToUse(uint256 currentEOANonce) external view returns (uint256) {
        uint256 nonceToUse = currentEOANonce + 10;
        if (nonceUsed[nonceToUse]) {
            nonceToUse++;
        }
        return nonceToUse;
    }
}
