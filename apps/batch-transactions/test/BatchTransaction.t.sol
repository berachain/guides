// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * This test demonstrates EIP-7702 delegation: a user wallet can delegate to a smart contract (BatchTransaction)
 * and execute a batch of transactions atomically using a single nonce. The test uses Foundry's signDelegation
 * and attachDelegation cheatcodes. All logic is tested here; no contracts are verified on-chain.
 *
 * Key steps:
 * 1. EOA signs a delegation to BatchTransaction (the implementation contract).
 * 2. The delegation is attached to the next call, enabling the EOA to act as a smart contract.
 * 3. The batch executes: deploys a token and mints to board members, all in one atomic operation.
 * 4. All balances and state are asserted in the test.
 *
 * Uses Solmate's ERC20 for minimal, gas-efficient token logic.
 */

import "forge-std/Test.sol";
import "../src/BatchTransaction.sol";
import "../src/UrsaToken.sol";
import "../src/VestingContract.sol";
import {ERC20} from "lib/solmate/src/tokens/ERC20.sol";

contract BatchTransactionTest is Test {
    BatchTransaction public batchTx;
    UrsaToken public token;
    VestingContract public vesting;
    address public ursa;
    address public alice;
    address public bob;
    address public charlie;
    uint256 public constant BOARD_MEMBER_SHARE = 50_000 ether;
    uint256 public constant LOCK_DURATION = 365 days;
    uint256 public constant TOTAL_SUPPLY = 1_000_000 ether;

    function setUp() public {
        // Setup test accounts
        ursa = vm.addr(1);
        alice = vm.addr(2);
        bob = vm.addr(3);
        charlie = vm.addr(4);

        // Deploy contracts
        batchTx = new BatchTransaction();
        token = new UrsaToken();
        vesting = new VestingContract(address(token));

        // Mint total supply to Ursa
        vm.prank(address(token.owner()));
        token.mint(ursa, TOTAL_SUPPLY);
    }

    function test_BatchApprovalsAndLocks() public {
        // Setup board members
        address[] memory boardMembers = new address[](3);
        boardMembers[0] = alice;
        boardMembers[1] = bob;
        boardMembers[2] = charlie;

        // Prepare transactions (3 approvals + 3 locks)
        BatchTransaction.Transaction[] memory txs = new BatchTransaction.Transaction[](6);
        
        // Approvals + Locks
        for (uint256 i = 0; i < 5; i += 2) {
            txs[i] = BatchTransaction.Transaction({
                target: address(token),
                value: 0,
                data: abi.encodeWithSelector(ERC20.approve.selector, address(vesting), BOARD_MEMBER_SHARE)
            });
            txs[i+1] = BatchTransaction.Transaction({
                target: address(vesting),
                value: 0,
                data: abi.encodeWithSelector(VestingContract.lockTokens.selector, boardMembers[i/2], BOARD_MEMBER_SHARE, LOCK_DURATION)
            });
        }

        // Sign delegation from Ursa to BatchTransaction
        vm.signAndAttachDelegation(address(batchTx), 1);

        // Execute batch as Ursa
        vm.startPrank(ursa);
        BatchTransaction(ursa).execute(txs);
        vm.stopPrank();

        // Verify vesting schedules
        for (uint256 i = 0; i < 3; i++) {
            (uint256 amount, uint256 unlockTime, bool claimed) = vesting.getVestingSchedule(boardMembers[i]);
            assertEq(amount, BOARD_MEMBER_SHARE, "Incorrect vesting amount");
            assertEq(unlockTime, block.timestamp + LOCK_DURATION, "Incorrect unlock time");
            assertFalse(claimed, "Tokens should not be claimed");
        }

        // Verify token balances
        assertEq(token.balanceOf(ursa), TOTAL_SUPPLY - (BOARD_MEMBER_SHARE * 3), "Incorrect Ursa balance");
        assertEq(token.balanceOf(address(vesting)), BOARD_MEMBER_SHARE * 3, "Incorrect vesting contract balance");
        assertEq(token.allowance(ursa, address(vesting)), 0, "Allowance should be used up");
    }

    function test_RevertWhen_BatchSizeExceedsLimit() public {
        // Create array exceeding MAX_BATCH_SIZE
        BatchTransaction.Transaction[] memory txs = new BatchTransaction.Transaction[](101);
        
        // Sign delegation from Ursa to BatchTransaction
        vm.signAndAttachDelegation(address(batchTx), 1);

        // Execute batch as Ursa
        vm.startPrank(ursa);
        vm.expectRevert("Batch too large");
        batchTx.execute(txs);
        vm.stopPrank();
    }

    function test_RevertWhen_TransactionFails() public {
        // Create invalid transaction that will definitely fail
        BatchTransaction.Transaction[] memory txs = new BatchTransaction.Transaction[](1);
        txs[0] = BatchTransaction.Transaction({
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(ERC20.transfer.selector, address(0), type(uint256).max) // This will definitely fail
        });

        // Sign delegation from Ursa to BatchTransaction
        vm.signAndAttachDelegation(address(batchTx), 1);

        // Execute batch as Ursa
        vm.startPrank(ursa);
        vm.expectRevert("Transaction failed");
        batchTx.execute(txs);
        vm.stopPrank();
    }
} 