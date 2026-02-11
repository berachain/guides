// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The purpose of this contract is to educate on ERC20 gas sponsorship where the user pays ERC20s to the SPONSOR for covering the gas transaction.
contract SimpleDelegatePart3 {
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
    error ERC20TokenPaymentFailed();

    event SuccessfulEIP7702Tx(address indexed sender, address indexed eoa, address indexed sponsor);
    event Reimbursed(address indexed sponsor, uint256 refund);
    event Burned(address indexed from, uint256 amount);
    event ERC20TokenPaymentMade(address indexed payer, address sponsor, uint256 tokenAmount);

    /// @dev Diff: adding in transferrance of ERC20 specified by the user (and FE) when calling `execute()`
    function execute(
        Call memory userCall,
        address sponsor,
        uint256 nonce,
        bytes calldata signature,
        address _token,
        uint256 _tokenAmount
    ) external payable {
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

        if(_tokenAmount > 0) {
        bool tokenTransfer = IERC20(_token).transfer(sponsor, _tokenAmount);
        if (!tokenTransfer) revert ERC20TokenPaymentFailed();
        }

        emit SuccessfulEIP7702Tx(msg.sender, recovered, sponsor);
        emit ERC20TokenPaymentMade(msg.sender, sponsor, _tokenAmount);
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
