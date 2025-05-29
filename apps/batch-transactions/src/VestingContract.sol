// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "lib/solmate/src/tokens/ERC20.sol";

contract VestingContract {
    struct VestingSchedule {
        uint256 amount;
        uint256 unlockTime;
        bool claimed;
    }

    ERC20 public immutable token;
    mapping(address => VestingSchedule) public vestingSchedules;

    event TokensLocked(address indexed beneficiary, uint256 amount, uint256 unlockTime);
    event TokensClaimed(address indexed beneficiary, uint256 amount);

    constructor(address _token) {
        token = ERC20(_token);
    }

    function lockTokens(address beneficiary, uint256 amount, uint256 lockDuration) external {
        require(amount > 0, "Amount must be greater than 0");
        require(beneficiary != address(0), "Invalid beneficiary address");
        require(vestingSchedules[beneficiary].amount == 0, "Beneficiary already has a vesting schedule");

        // Transfer tokens from the sender to this contract
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");

        // Create vesting schedule
        vestingSchedules[beneficiary] = VestingSchedule({
            amount: amount,
            unlockTime: block.timestamp + lockDuration,
            claimed: false
        });

        emit TokensLocked(beneficiary, amount, block.timestamp + lockDuration);
    }

    function claimTokens() external {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        require(schedule.amount > 0, "No vesting schedule found");
        require(!schedule.claimed, "Tokens already claimed");
        require(block.timestamp >= schedule.unlockTime, "Tokens are still locked");

        uint256 amount = schedule.amount;
        schedule.claimed = true;
        schedule.amount = 0;

        require(token.transfer(msg.sender, amount), "Token transfer failed");
        emit TokensClaimed(msg.sender, amount);
    }

    function getVestingSchedule(address beneficiary) external view returns (uint256 amount, uint256 unlockTime, bool claimed) {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        return (schedule.amount, schedule.unlockTime, schedule.claimed);
    }
} 