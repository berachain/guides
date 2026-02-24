// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Honey.sol";
import "./Permit2/IPermit2.sol";
import "./Permit2/IAllowanceTransfer.sol";
import "./Permit2/ISignatureTransfer.sol";

/**
 * @title Demo
 * @dev Demo contract demonstrating different approval methods
 */
contract Demo {
    Honey public immutable honey;
    IPermit2 public immutable permit2;

    event TokensReceived(address indexed from, address indexed to, uint256 amount, string method);

    constructor(address _honey, address _permit2) {
        honey = Honey(_honey);
        permit2 = IPermit2(_permit2);
    }

    /**
     * @dev Transfer tokens using EIP-2612 permit.
     *      The permit grants this contract an allowance, then we transfer to `to`.
     */
    function transferFromWithPermit(
        address owner,
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // First, call permit on the token (spender = this contract)
        honey.permit(owner, address(this), value, deadline, v, r, s);
        
        // Then transfer from owner to the specified recipient
        honey.transferFrom(owner, to, value);
        
        emit TokensReceived(owner, to, value, "EIP-2612");
    }

    /**
     * @dev Transfer tokens using Permit2 AllowanceTransfer.
     *      The permit grants this contract Permit2 allowance, then we transfer to `to`.
     */
    function transferFromWithPermit2Allowance(
        address owner,
        IAllowanceTransfer.PermitSingle memory permitSingle,
        bytes calldata signature,
        address to
    ) external {
        // Approve via Permit2
        permit2.permit(owner, permitSingle, signature);
        
        // Transfer via Permit2 to the specified recipient
        permit2.transferFrom(
            owner,
            to,
            permitSingle.details.amount,
            permitSingle.details.token
        );
        
        emit TokensReceived(owner, to, permitSingle.details.amount, "Permit2-Allowance");
    }

    /**
     * @dev Transfer tokens using Permit2 SignatureTransfer.
     *      The destination is specified in transferDetails.to (controlled by caller).
     */
    function transferFromWithPermit2Signature(
        ISignatureTransfer.PermitTransferFrom memory permit,
        ISignatureTransfer.SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external {
        // Transfer directly via Permit2 signature (no allowance needed)
        permit2.permitTransferFrom(permit, transferDetails, owner, signature);
        
        emit TokensReceived(owner, transferDetails.to, transferDetails.requestedAmount, "Permit2-Signature");
    }

    /**
     * @dev Transfer tokens using EIP-3009 transferWithAuthorization.
     *      The destination is specified in `to` (part of the signed message).
     */
    function transferFromWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // Transfer directly via authorization (no allowance needed)
        honey.transferWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        
        emit TokensReceived(from, to, value, "EIP-3009");
    }
}
