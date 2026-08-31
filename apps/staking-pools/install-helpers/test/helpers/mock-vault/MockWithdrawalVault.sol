// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

/// Minimal vault double for the proof-fixture withdrawal address, which is an
/// EOA on bepolia. Event signatures match IWithdrawalVault so receipts hash
/// recovery can scan the same topics the live vault emits. Tracks just
/// enough per-request state (owner + requestBlock) to support the
/// balanceOf/tokenOfOwnerByIndex/getWithdrawalRequest enumeration the
/// finalize-all path drives.
contract MockWithdrawalVault {
    address public constant EIP_7002 = 0x00000961Ef480Eb55e80D19ad83579A64c007002;

    uint256 public nextId;

    struct Request {
        address user;
        uint256 requestBlock;
    }

    mapping(uint256 => Request) internal _requests;
    mapping(address => uint256[]) internal _ownedRequestIds;

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
        requestId = _mintRequest(msg.sender);
        emit WithdrawalRequested(msg.sender, uint256(assetsInGWei) * 1 gwei, 0, requestId, false);
    }

    function requestRedeem(bytes calldata, uint256 shares, uint256) external payable returns (uint256 requestId) {
        requestId = _mintRequest(msg.sender);
        emit WithdrawalRequested(msg.sender, 0, shares, requestId, false);
    }

    function _mintRequest(address user) internal returns (uint256 requestId) {
        requestId = ++nextId;
        _requests[requestId] = Request({ user: user, requestBlock: block.number });
        _ownedRequestIds[user].push(requestId);
    }

    function balanceOf(address user) external view returns (uint256) {
        return _ownedRequestIds[user].length;
    }

    function tokenOfOwnerByIndex(address user, uint256 index) external view returns (uint256) {
        return _ownedRequestIds[user][index];
    }

    function getWithdrawalRequest(uint256 requestId)
        external
        view
        returns (bytes memory pubkey, uint256 assetsRequested, uint256 sharesBurnt, address user, uint256 requestBlock)
    {
        Request memory request = _requests[requestId];
        return ("", 0, 0, request.user, request.requestBlock);
    }

    function finalizeWithdrawalRequest(uint256 requestId) external {
        _burnRequest(requestId);
        emit WithdrawalRequestFinalized(requestId);
    }

    function finalizeWithdrawalRequests(uint256[] calldata requestIds) external {
        for (uint256 i = 0; i < requestIds.length; i++) {
            _burnRequest(requestIds[i]);
            emit WithdrawalRequestFinalized(requestIds[i]);
        }
    }

    /// Mirrors the real vault's _burn(requestId) on finalize: the request no
    /// longer counts toward the holder's balanceOf/tokenOfOwnerByIndex.
    function _burnRequest(uint256 requestId) internal {
        address user = _requests[requestId].user;
        uint256[] storage owned = _ownedRequestIds[user];
        for (uint256 i = 0; i < owned.length; i++) {
            if (owned[i] == requestId) {
                owned[i] = owned[owned.length - 1];
                owned.pop();
                break;
            }
        }
    }

    /// Test-only: backdates a request's requestBlock so integration tests can
    /// exercise the finalization-delay boundary without mining hundreds of
    /// thousands of real blocks against a rate-limited fork RPC.
    function setRequestBlockForTesting(uint256 requestId, uint256 newRequestBlock) external {
        _requests[requestId].requestBlock = newRequestBlock;
    }
}
