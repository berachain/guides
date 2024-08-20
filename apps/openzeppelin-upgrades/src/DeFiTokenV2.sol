// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IBerachainRewardsVault {
    function delegateStake(address account, uint256 amount) external;
    function delegateWithdraw(address account, uint256 amount) external;
}

/// @custom:oz-upgrades-from DeFiToken
contract DeFiTokenV2 is ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    mapping(address => uint256) public lastBonusTimestamp;
    mapping(address => uint256) public bonusBalance;
    IBerachainRewardsVault public rewardsVault;
    uint256 public constant BONUS_PERIOD = 30 days;

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

        // Update user's bonus balance
        bonusBalance[account] += newBonusAmount;

        // Delegate additional stake
        rewardsVault.delegateStake(account, newBonusAmount);

        lastBonusTimestamp[account] = block.timestamp;
        emit BonusApplied(account, newBonusAmount);
    }

    function calculateBonus(address account) public view returns (uint256) {
        uint256 userBalance = balanceOf(account);
        uint256 timeSinceLastBonus = block.timestamp -
            lastBonusTimestamp[account];

        // Every 30 days bonus increases by 1.5x
        uint256 multiplier = 100 + ((timeSinceLastBonus * 50) / BONUS_PERIOD);

        return (userBalance * (multiplier - 100)) / 100;
    }

    function removeBonus(address account) internal {
        if (bonusBalance[account] <= 0) return;

        uint256 bonusToRemove = bonusBalance[account];
        rewardsVault.delegateWithdraw(account, bonusToRemove);
        _burn(address(this), bonusToRemove);

        bonusBalance[account] = 0;
        lastBonusTimestamp[account] = 0;

        emit BonusRemoved(account, bonusToRemove);
    }

    function transfer(
        address to,
        uint256 amount
    ) public override returns (bool) {
        // Remove bonus when transferring out
        if (msg.sender != address(0)) {
            removeBonus(msg.sender);
        }
        return super.transfer(to, amount);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    event BonusApplied(address indexed user, uint256 bonusAmount);
    event BonusRemoved(address indexed user, uint256 bonusAmount);
}
