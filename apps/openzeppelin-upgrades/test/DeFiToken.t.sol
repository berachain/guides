// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/DeFiTokenV1.sol";
import "../src/DeFiTokenV2.sol";
import "forge-std/console.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

// Mock RewardsVault contract
contract MockRewardsVault {
    mapping(address => uint256) public delegatedStakes;

    function delegateStake(address account, uint256 amount) external {
        delegatedStakes[account] += amount;
    }

    function delegateWithdraw(address account, uint256 amount) external {
        delegatedStakes[account] -= amount;
    }
}

contract DeFiTokenTest is Test {
    DeFiToken deFiToken;
    DeFiTokenV2 deFiTokenV2;
    ERC1967Proxy proxy;
    address owner;
    address user1;
    address user2;
    MockRewardsVault mockRewardsVault;

    function setUp() public {
        // Deploy the token implementation
        DeFiToken implementation = new DeFiToken();

        // Define addresses
        owner = vm.addr(1);
        user1 = vm.addr(2);
        user2 = vm.addr(3);

        vm.startPrank(owner);
        // Deploy the proxy and initialize the contract through the proxy
        proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(implementation.initialize, owner)
        );

        // Attach the DeFiToken interface to the deployed proxy
        deFiToken = DeFiToken(address(proxy));
        vm.stopPrank();

        // Deploy mock RewardsVault
        mockRewardsVault = new MockRewardsVault();
    }

    function testInitialERC20Functionality() public {
        vm.startPrank(owner);
        deFiToken.mint(user1, 1000 * 1e18);
        vm.stopPrank();

        assertEq(deFiToken.balanceOf(user1), 1000 * 1e18);
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
    function testBoostedStakingFunctionality() public {
        testUpgradeToV2();

        // Set the RewardsVault
        vm.prank(owner);
        deFiTokenV2.setRewardsVault(address(mockRewardsVault));

        // Mint tokens to user1
        vm.prank(owner);
        deFiTokenV2.mint(user1, 1000 * 1e18);

        // Fast forward 15 days
        vm.warp(block.timestamp + 15 days);

        // Apply bonus for user1
        deFiTokenV2.applyBonus(user1);

        // Check bonus balance
        uint256 expectedBonus = (1000 * 1e18 * 25) / 100; // 25% bonus after 15 days
        assertEq(deFiTokenV2.bonusBalance(user1), expectedBonus);

        // Check delegated stake in mock RewardsVault
        assertEq(mockRewardsVault.delegatedStakes(user1), expectedBonus);

        // Fast forward another 30 days
        vm.warp(block.timestamp + 30 days);

        // Apply bonus again
        deFiTokenV2.applyBonus(user1);

        // Check updated bonus balance (should be 75% now: 25% + 50%)
        expectedBonus = (1000 * 1e18 * 75) / 100;
        assertEq(deFiTokenV2.bonusBalance(user1), expectedBonus);

        // Check updated delegated stake (should also be 75%)
        assertEq(mockRewardsVault.delegatedStakes(user1), expectedBonus);

        // Test bonus removal on transfer
        vm.prank(user1);
        deFiTokenV2.transfer(user2, 500 * 1e18);

        // Check that bonus is removed
        assertEq(deFiTokenV2.bonusBalance(user1), 0);
        assertEq(mockRewardsVault.delegatedStakes(user1), 0);
    }
}
