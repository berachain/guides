// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IBerachainRewardsVault {
    function delegateStake(address account, uint256 amount) external;
    function delegateWithdraw(address account, uint256 amount) external;

    function getTotalDelegateStaked(
        address account
    ) external view returns (uint256);
}

/// @custom:oz-upgrades-from DeFiToken
contract DeFiTokenV2 is ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    IBerachainRewardsVault public rewardsVault;
    uint256 public constant BONUS_RATE = 50; // 50% bonus per 30 days
    uint256 public constant BONUS_PERIOD = 30 days;
    mapping(address => uint256) public lastBonusTimestamp;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public reinitializer(2) {
        __ERC20_init("DeFi Token V2", "DFTV2");
    }

    function setRewardsVault(address _rewardsVault) external onlyOwner {
        rewardsVault = IBerachainRewardsVault(_rewardsVault);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function applyBonus(address account) external {
        uint256 newBonusAmount = calculateBonus(account);
        require(newBonusAmount > 0, "No bonus to apply");

        // Mint new bonus tokens to this contract
        _mint(address(this), newBonusAmount);

        // Delegate new bonus stake
        rewardsVault.delegateStake(account, newBonusAmount);

        lastBonusTimestamp[account] = block.timestamp;
    }

    function calculateBonus(address account) public view returns (uint256) {
        uint256 userBalance = balanceOf(account);
        uint256 timeSinceLastBonus = block.timestamp -
            lastBonusTimestamp[account];
        return
            (userBalance * BONUS_RATE * timeSinceLastBonus) /
            (100 * BONUS_PERIOD);
    }

    function getBonusBalance(address account) public view returns (uint256) {
        return rewardsVault.getTotalDelegateStaked(account);
    }

    function removeBonus(address account) internal {
        uint256 bonusToRemove = getBonusBalance(account);
        if (bonusToRemove > 0) {
            rewardsVault.delegateWithdraw(account, bonusToRemove);
            _burn(address(this), bonusToRemove);
            lastBonusTimestamp[account] = 0;
        }
    }

    function transfer(
        address to,
        uint256 amount
    ) public override returns (bool) {
        removeBonus(msg.sender);
        return super.transfer(to, amount);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
