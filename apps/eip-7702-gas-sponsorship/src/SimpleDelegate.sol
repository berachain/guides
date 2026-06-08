// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title SimpleDelegate Educational Contract - Part A
/// @notice An example implementation contract showcasing transactions with gas sponsorship leveraging EIP-7702
/// @dev Since the EOA prepares their own transactions (via a UI, their own code, etc.), they will have full reign on what is in their transaction. Thus having generic implementation contract code that an EOA points to for carrying out low level calls is acceptable.
/// @dev This contract, as is, showcases gas sponsorship. Part B of the EIP-7702 gas sponsorship guide adds signer validation, application-level nonce replay protection, and chain ID checks.
contract SimpleDelegate {
    /// State Vars
    struct Call {
        bytes data;
        address to;
        uint256 value;
    }

    /// Error Statements
    error ExternalCallFailed();
    error ReimbursementFailed();

    /// Events
    event HenloSaid(address indexed sender, address indexed eoa, string message);
    event Reimbursed(address indexed sponsor, uint256 refund);

    function execute(Call memory userCall, address sponsor) external payable {
        // Begin gas tracking
        uint256 startGas = gasleft();

        // Execute the user-intended call
        (bool success,) = userCall.to.call{value: userCall.value}(userCall.data);
        if (!success) revert ExternalCallFailed();

        // Calculate gas used and refund
        uint256 gasUsed = startGas - gasleft();
        uint256 gasCost = gasUsed * tx.gasprice;
        uint256 refund = (msg.value > gasCost) ? (msg.value - gasCost) : 0;

        if (refund > 0) {
            (bool refunded,) = sponsor.call{value: refund}("");
            require(refunded, ReimbursementFailed());
            emit Reimbursed(sponsor, refund);
        }

        emit HenloSaid(msg.sender, address(this), "Henlo triggered!");
    }
}
