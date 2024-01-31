// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console2, stdError} from "forge-std/Test.sol";
import {BingBongToken} from "../src/BingBongToken.sol";

contract BingBongTokenTest is Test {
    // Variables
    BingBongToken public token;
    address supplyOwnerAddress = makeAddr("BerachainWalletUser"); // 0xE3284cB941608AA9E65F7EDdbb50c461D936622f
    address randomWalletAddress = makeAddr("GiveMeTokens"); // 0x187A660c372Fa04D09C1A71f2927911e62e98a89
    address anotherWalletAddress = makeAddr("AnotherAddress"); // 0x0F3B9cC98eef350B12D5b7a338D8B76c2F9a92CC
    error ERC20InvalidReceiver(address receiver);

    // Initial Read Tests
    // ========================================================    
    /**
     * @dev Initial contract setup
     */
    function setUp() public {
        vm.prank(supplyOwnerAddress);
        token = new BingBongToken("BingBong Token", "BBT", 10000);
    }

    /**
     * @dev Test initiatted token name
     */
    function test_name() public {
        assertEq(token.name(), "BingBong Token");
    }

    /**
     * @dev Test initiatted token symbol
     */
    function test_symbol() public {
        assertEq(token.symbol(), "BBT");
    }

    /**
     * @dev Test default decimals
     */
    function test_decimals() public {
        assertEq(token.decimals(), 18);
    }

    /**
     * @dev Test initial total token supply
     */
    function test_totalSupply() public {
        assertEq(token.totalSupply(), 10000);
    }

    /**
     * @dev Test initial random account balance
     */
    function test_balanceOfAddress0() public {
        assertEq(token.balanceOf(address(0)), 0);
    }

    /**
     * @dev Test account balance of original deployer
     */
    function test_balanceOfAddressSupplyOwner() public {
        assertEq(token.balanceOf(supplyOwnerAddress), 10000);
    }

    /**
     * @dev Test Revert transfer to sender as 0x0
     */
    function test_transferRevertInvalidSender() public {
        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidSender(address)", address(0)));
        token.transfer(randomWalletAddress, 100);
    }

    /**
     * @dev Test Revert transfer to receiver as 0x0
     */
    function test_transferRevertInvalidReceiver() public {
        vm.prank(supplyOwnerAddress);
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidReceiver(address)", address(0)));
        token.transfer(address(0), 100);
    }

    /**
     * @dev Test Revert transfer to sender with insufficient balance
     */
    function test_transferRevertInsufficientBalance() public {
        vm.prank(randomWalletAddress);
        // NOTE: Make sure to keep this string for `encodeWithSignature` free of spaces for the string (" ")
        vm.expectRevert(abi.encodeWithSignature("ERC20InsufficientBalance(address,uint256,uint256)", randomWalletAddress, 0, 100));
        token.transfer(supplyOwnerAddress, 100);
    }

    /**
     * @dev Test transfer to receiver from sender with sufficient balance
     */
    function test_transfer() public {
        vm.prank(supplyOwnerAddress);
        assertEq(token.transfer(randomWalletAddress, 100), true);
        assertEq(token.balanceOf(randomWalletAddress), 100);
        assertEq(token.balanceOf(supplyOwnerAddress), 10000 - 100);
    }

    /**
     * @dev Test allowance of random address for supplyOwner
     */
    function test_allowance() public {
        assertEq(token.allowance(supplyOwnerAddress, randomWalletAddress), 0);
    }

    /**
     * @dev Test Revert approve of owner as 0x0
     */
    function test_approveRevertInvalidApprover() public {
        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidApprover(address)", address(0)));
        token.approve(randomWalletAddress, 100);
    }

    /**
     * @dev Test Revert approve of spender as 0x0
     */
    function test_approveRevertInvalidSpender() public {
        vm.prank(supplyOwnerAddress);
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidSpender(address)", address(0)));
        token.approve(address(0), 100);
    }

    /**
     * @dev Test approve of spender for 0 and 50
     */
    function test_approve() public {
        vm.prank(supplyOwnerAddress);
        assertEq(token.approve(randomWalletAddress, 0), true);
        assertEq(token.approve(randomWalletAddress, 50), true);
    }

    /**
     * @dev Test Revert transferFrom of spender with 0 approveed
     */
    function test_transferFromRevertInsufficientAllowanceFor0x0() public {
        vm.prank(supplyOwnerAddress);
        vm.expectRevert(abi.encodeWithSignature("ERC20InsufficientAllowance(address,uint256,uint256)", supplyOwnerAddress, 0, 100));
        token.transferFrom(randomWalletAddress, address(0), 100);
    }

    /**
     * @dev Test Revert transferFrom of spender transferring to 0x0
     */
    function test_transferFromRevertInvalidReceiver() public {
        // Setup
        vm.prank(supplyOwnerAddress);
        token.approve(randomWalletAddress, 30);

        // Test
        vm.prank(randomWalletAddress);
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidReceiver(address)", address(0)));
        token.transferFrom(supplyOwnerAddress, address(0), 30);
    }

    /**
     * @dev Test Revert transferFrom of spender transferring 50/30 approved
     */
    function test_transferFromRevertInsufficientAllowance() public {
        // Setup
        vm.prank(supplyOwnerAddress);
        token.approve(randomWalletAddress, 30);

        // Test
        vm.prank(randomWalletAddress);
        vm.expectRevert(abi.encodeWithSignature("ERC20InsufficientAllowance(address,uint256,uint256)", randomWalletAddress, 30, 50));
        token.transferFrom(supplyOwnerAddress, anotherWalletAddress, 50);
    }

    /**
     * @dev Test transferFrom of spender 10/30 approved
     */
    function test_transferFrom() public {
        // Setup
        vm.prank(supplyOwnerAddress);
        token.approve(randomWalletAddress, 30);

        // Test
        vm.prank(randomWalletAddress);
        assertEq(token.transferFrom(supplyOwnerAddress, anotherWalletAddress, 10), true);
        assertEq(token.balanceOf(anotherWalletAddress), 10);
        assertEq(token.balanceOf(supplyOwnerAddress), 10000 - 10);
        assertEq(token.allowance(supplyOwnerAddress, randomWalletAddress), 30 - 10);
    }
}
