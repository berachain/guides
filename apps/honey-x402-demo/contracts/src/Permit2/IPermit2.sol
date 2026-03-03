// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import "./IAllowanceTransfer.sol";
import "./ISignatureTransfer.sol";

/// @notice The main Permit2 interface
interface IPermit2 is IAllowanceTransfer, ISignatureTransfer {
    // This interface combines both IAllowanceTransfer and ISignatureTransfer
}
