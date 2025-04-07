// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import "../src/DeFiTokenV1.sol";
import "../src/DeFiTokenV2.sol";
import "forge-std/console.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract MockRewardsVault {
    mapping(address => uint256) public delegatedStakes;

    function delegateStake(address account, uint256 amount) external {
        delegatedStakes[account] += amount;
    }

    function delegateWithdraw(address account, uint256 amount) external {
        require(
            delegatedStakes[account] >= amount,
            "Insufficient delegated stake"
        );
        delegatedStakes[account] -= amount;
    }

    function getTotalDelegateStaked(
        address account
    ) external view returns (uint256) {
        return delegatedStakes[account];
    }
}

contract DeFiTokenTest is Test {
    DeFiToken deFiToken;
    DeFiTokenV2 deFiTokenV2;
    ERC1967Proxy proxy;
    address owner;
    address user1;
    MockRewardsVault mockRewardsVault;

    function setUp() public {
        DeFiToken implementation = new DeFiToken();
        owner = vm.addr(1);
        user1 = vm.addr(2);

        vm.startPrank(owner);
        proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(implementation.initialize, owner)
        );
        deFiToken = DeFiToken(address(proxy));
        vm.stopPrank();

        mockRewardsVault = new MockRewardsVault();
    }

    function testBoostedStakingFunctionality() public {
        testUpgradeToV2();

        vm.startPrank(owner);
        deFiTokenV2.setRewardsVault(address(mockRewardsVault));
        deFiTokenV2.mint(user1, 1000 * 1e18);
        vm.stopPrank();

        // Fast forward 15 days
        vm.warp(block.timestamp + 15 days);

        // Apply bonus for user1
        vm.prank(user1);
        deFiTokenV2.applyBonus(user1);

        // Check bonus balance (should be 25% of user's balance after 15 days)
        uint256 expectedBonus = (1000 * 1e18 * 25) / 100;
        assertApproxEqAbs(
            deFiTokenV2.getBonusBalance(user1),
            expectedBonus,
            1e15
        );

        // Fast forward another 30 days
        vm.warp(block.timestamp + 30 days);

        // Apply bonus again (should be 75% of user's balance)
        vm.prank(user1);
        deFiTokenV2.applyBonus(user1);
        expectedBonus = (1000 * 1e18 * 75) / 100;
        assertApproxEqAbs(
            deFiTokenV2.getBonusBalance(user1),
            expectedBonus,
            1e15
        );

        // Test bonus removal on transfer
        vm.prank(user1);
        deFiTokenV2.transfer(owner, 500 * 1e18);

        // Check that bonus is removed
        assertEq(deFiTokenV2.getBonusBalance(user1), 0);
    }

    function testUpgradeToV2() public {
        vm.startPrank(owner);
        Upgrades.upgradeProxy(
            address(proxy),
            "DeFiTokenV2.sol:DeFiTokenV2",
            abi.encodeCall(DeFiTokenV2.initialize, ())
        );
        vm.stopPrank();

        deFiTokenV2 = DeFiTokenV2(address(proxy));
        assertTrue(address(deFiTokenV2) == address(proxy));
    }
}
