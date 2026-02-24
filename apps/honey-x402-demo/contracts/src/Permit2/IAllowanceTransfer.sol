// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The interface for the allowance transfer contract
interface IAllowanceTransfer {
    /// @notice Details for a permit single signature
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    /// @notice Details for a permit batch signature
    struct PermitBatch {
        PermitDetails[] details;
        address spender;
        uint256 sigDeadline;
    }

    /// @notice Details for a permit single signature
    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    /// @notice Approves the spender to use the owner's tokens via signature
    function permit(
        address owner,
        PermitSingle memory permitSingle,
        bytes calldata signature
    ) external;

    /// @notice Approves the spender to use the owner's tokens via signature
    function permit(
        address owner,
        PermitBatch memory permitBatch,
        bytes calldata signature
    ) external;

    /// @notice Transfers tokens from owner to recipient
    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;
}
