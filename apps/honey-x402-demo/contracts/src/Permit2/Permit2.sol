// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import "./IPermit2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Permit2
 * @notice Minimal Permit2 implementation for local development / demo purposes.
 *         Supports SignatureTransfer (one-time) and AllowanceTransfer (reusable).
 */
contract Permit2 is IPermit2 {
    // ──────────────────── EIP-712 ────────────────────

    bytes32 private immutable _DOMAIN_SEPARATOR;

    bytes32 private constant _TOKEN_PERMISSIONS_TYPEHASH =
        keccak256("TokenPermissions(address token,uint256 amount)");

    bytes32 private constant _PERMIT_TRANSFER_FROM_TYPEHASH =
        keccak256(
            "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)"
            "TokenPermissions(address token,uint256 amount)"
        );

    bytes32 private constant _PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");

    bytes32 private constant _PERMIT_SINGLE_TYPEHASH =
        keccak256(
            "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
            "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
        );

    // ──────────────── Signature Transfer state ────────────────

    /// @dev Bitmap-based nonce tracking: owner → (wordPos → bitmap)
    mapping(address => mapping(uint256 => uint256)) private _nonceBitmap;

    // ──────────────── Allowance Transfer state ────────────────

    struct PackedAllowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    /// @dev owner → token → spender → allowance
    mapping(address => mapping(address => mapping(address => PackedAllowance))) private _allowances;

    // ──────────────────── Constructor ────────────────────

    constructor() {
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                address(this)
            )
        );
    }

    // ════════════════════════════════════════════════════
    //                  SIGNATURE TRANSFER
    // ════════════════════════════════════════════════════

    /// @inheritdoc ISignatureTransfer
    function permitTransferFrom(
        ISignatureTransfer.PermitTransferFrom memory permit,
        ISignatureTransfer.SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external override {
        require(block.timestamp <= permit.deadline, "Permit2: signature expired");

        // Consume nonce (bitmap-based, reverts if already used)
        _useUnorderedNonce(owner, permit.nonce);

        // Build EIP-712 struct hash (spender = msg.sender)
        bytes32 tokenPermissionsHash = keccak256(
            abi.encode(_TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount)
        );
        bytes32 structHash = keccak256(
            abi.encode(
                _PERMIT_TRANSFER_FROM_TYPEHASH,
                tokenPermissionsHash,
                msg.sender,
                permit.nonce,
                permit.deadline
            )
        );

        _verifySig(_DOMAIN_SEPARATOR, structHash, owner, signature);

        require(
            transferDetails.requestedAmount <= permit.permitted.amount,
            "Permit2: requested amount exceeds permitted"
        );

        IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }

    /// @inheritdoc ISignatureTransfer
    function permitTransferFrom(
        ISignatureTransfer.PermitBatchTransferFrom memory,
        ISignatureTransfer.SignatureTransferDetails[] calldata,
        address,
        bytes calldata
    ) external pure override {
        revert("Permit2: batch not implemented");
    }

    // ════════════════════════════════════════════════════
    //                  ALLOWANCE TRANSFER
    // ════════════════════════════════════════════════════

    /// @inheritdoc IAllowanceTransfer
    function permit(
        address owner,
        IAllowanceTransfer.PermitSingle memory permitSingle,
        bytes calldata signature
    ) external override {
        require(block.timestamp <= permitSingle.sigDeadline, "Permit2: signature expired");

        bytes32 detailsHash = keccak256(
            abi.encode(
                _PERMIT_DETAILS_TYPEHASH,
                permitSingle.details.token,
                permitSingle.details.amount,
                permitSingle.details.expiration,
                permitSingle.details.nonce
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_SINGLE_TYPEHASH, detailsHash, permitSingle.spender, permitSingle.sigDeadline)
        );

        _verifySig(_DOMAIN_SEPARATOR, structHash, owner, signature);

        PackedAllowance storage allowed =
            _allowances[owner][permitSingle.details.token][permitSingle.spender];

        require(permitSingle.details.nonce == allowed.nonce, "Permit2: invalid nonce");

        allowed.amount = permitSingle.details.amount;
        allowed.expiration = permitSingle.details.expiration;
        allowed.nonce = permitSingle.details.nonce + 1;
    }

    /// @inheritdoc IAllowanceTransfer
    function permit(
        address,
        IAllowanceTransfer.PermitBatch memory,
        bytes calldata
    ) external pure override {
        revert("Permit2: batch not implemented");
    }

    /// @inheritdoc IAllowanceTransfer
    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external override {
        PackedAllowance storage allowed = _allowances[from][token][msg.sender];

        if (allowed.expiration != 0) {
            require(block.timestamp <= allowed.expiration, "Permit2: allowance expired");
        }
        require(allowed.amount >= amount, "Permit2: insufficient allowance");

        unchecked {
            allowed.amount -= amount;
        }

        IERC20(token).transferFrom(from, to, amount);
    }

    // ════════════════════════════════════════════════════
    //                     INTERNALS
    // ════════════════════════════════════════════════════

    function _useUnorderedNonce(address owner, uint256 nonce) internal {
        uint256 wordPos = nonce >> 8;
        uint256 bitPos = nonce & 0xff;
        uint256 bit = 1 << bitPos;

        uint256 flipped = _nonceBitmap[owner][wordPos] ^= bit;
        require(flipped & bit != 0, "Permit2: nonce already used");
    }

    function _verifySig(
        bytes32 domainSeparator,
        bytes32 structHash,
        address expectedSigner,
        bytes calldata signature
    ) internal pure {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signer = ECDSA.recover(digest, signature);
        require(signer == expectedSigner, "Permit2: invalid signature");
    }
}
