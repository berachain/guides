// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

/// Minimal vault double for the proof-fixture withdrawal address, which is an
/// EOA on bepolia. Event signatures match IWithdrawalVault so receipts hash
/// recovery can scan the same topics the live vault emits.
contract MockWithdrawalVault {
    address public constant EIP_7002 = 0x00000961Ef480Eb55e80D19ad83579A64c007002;

    uint256 public nextId;

    event WithdrawalRequested(
        address indexed user,
        uint256 amountOfAsset,
        uint256 amountOfShares,
        uint256 requestId,
        bool isFullExitWithdraw
    );
    event WithdrawalRequestFinalized(uint256 requestId);

    receive() external payable {}

    /// Mirrors ELWithdrawHelper._getWithdrawalRequestFee(): a direct read off
    /// the real EIP-7002 predeploy, which exists on any bepolia fork.
    function getWithdrawalRequestFee() external view returns (uint256) {
        (bool success, bytes memory data) = EIP_7002.staticcall("");
        require(success, "fee read failed");
        return abi.decode(data, (uint256));
    }

    function requestWithdrawal(bytes calldata, uint64 assetsInGWei, uint256)
        external
        payable
        returns (uint256 requestId)
    {
        requestId = ++nextId;
        emit WithdrawalRequested(msg.sender, uint256(assetsInGWei) * 1 gwei, 0, requestId, false);
    }

    function requestRedeem(bytes calldata, uint256 shares, uint256) external payable returns (uint256 requestId) {
        requestId = ++nextId;
        emit WithdrawalRequested(msg.sender, 0, shares, requestId, false);
    }

    function finalizeWithdrawalRequest(uint256 requestId) external {
        emit WithdrawalRequestFinalized(requestId);
    }
}
