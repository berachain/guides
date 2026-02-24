// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

/// @notice The interface for the signature transfer contract
interface ISignatureTransfer {
    /// @notice Details for a token transfer
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    /// @notice Details for a permit transfer signature
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Details for a permit transfer signature with witness
    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Transfers tokens using a signed permit message
    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice Transfers tokens using a signed permit batch message
    function permitTransferFrom(
        PermitBatchTransferFrom memory permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice Details for a signature transfer
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }
}
