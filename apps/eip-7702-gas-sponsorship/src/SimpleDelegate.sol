// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title SimpleDelegate Educational Contract - Part A
/// @notice An example implementation contract showcasing transactions with gas sponsorship leveraging EIP-7702
/// @dev Since the EOA prepares their own transactions (via a UI, their own code, etc.), they will have full reign on what is in their transaction. Thus having generic implementation contract code that an EOA points to for carrying out low level calls is acceptable.
/// @dev This contract, as is, showcases gas sponsorship. Later parts of the guide show: 1.) Initializing a contract, that will become a specific contract to an EOA basically, 2.) Having a check to ensure that the signer is the EOA for a sponsored call using solidity scripts and foundry to construct the signed transaction. Code commented out pertains to these later parts.
contract SimpleDelegate {
    
    /// State Vars
    struct Call {
    bytes data;
    address to;
    uint256 value;
    }

    // mapping(uint256 => bool) public nonceUsed; // Whether EOA nonce has been used or not

    /// Error Statements
    error ExternalCallFailed();
    error ReimbursementFailed();
    error InvalidSignature();
    error NonceAlreadyUsed();

    /// Events
    event HenloSaid(address indexed sender, address indexed eoa, string message);
    event Reimbursed(address indexed sponsor, uint256 refund);

    function execute(Call memory call, address sponsor, uint256 nonce) external payable {
        // // Check: nonce hasn't been used
        // // TODO - EIP 7702 storage with implementation code is not persistent, so this check doesn't work and checks are needed in offchain logic.
        // if (nonceUsed[nonce]) revert NonceAlreadyUsed();
        // nonceUsed[nonce] = true; // Mark nonce as used

        // Begin gas tracking
        uint256 startGas = gasleft();

        // Execute the user-intended call
        (bool success, ) = call.to.call{value: call.value}(call.data);
        if (!success) revert ExternalCallFailed();

        // Calculate gas used and refund
        uint256 gasUsed = startGas - gasleft();
        uint256 gasCost = gasUsed * tx.gasprice;
        uint256 refund = (msg.value > gasCost) ? (msg.value - gasCost) : 0;

        if (refund > 0) {
            (bool refunded, ) = sponsor.call{value: refund}("");
            require(refunded, ReimbursementFailed());
            emit Reimbursed(sponsor, refund);
        }

        emit HenloSaid(msg.sender, address(this), "Henlo triggered!");
    }

    // function henlo() external returns (string memory) {
    //     emit HenloSaid(msg.sender, address(this), "Henlo triggered!");
    //     return "henlo!";
    // }

    function getNonceToUse(uint256 currentEOANonce) external view returns (uint256) {
    uint256 nonceToUse = currentEOANonce + 10;

    // // skip if already used
    // if (nonceUsed[nonceToUse]) {
    //     nonceToUse++;
    // }

    return nonceToUse;
    }

}