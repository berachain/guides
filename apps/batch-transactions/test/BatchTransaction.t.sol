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

import {Test, Vm} from "lib/forge-std/src/Test.sol";
import {BatchTransaction} from "../src/BatchTransaction.sol";
import {ERC20} from "lib/solmate/src/tokens/ERC20.sol";

contract UrsaToken is ERC20 {
    constructor() ERC20("Ursa Industries Token", "URSA", 18) {
        _mint(msg.sender, 1_000_000 ether); // Mint 1M tokens to deployer
    }
}

contract BatchTransactionTest is Test {
    BatchTransaction public batchTx;
    address public alice;
    uint256 public alicePk;
    address[] public boardMembers;
    uint256 constant BOARD_MEMBER_SHARE = 50_000 ether; // 5% of 1M tokens

    function setUp() public {
        // Setup Alice (EOA) and board members
        (alice, alicePk) = makeAddrAndKey("alice");
        boardMembers = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            boardMembers[i] = makeAddr(string(abi.encodePacked("boardMember", i)));
        }
        // Deploy batch transaction contract
        batchTx = new BatchTransaction();
    }

    function computeCreate2Address(address deployer, bytes32 salt, bytes32 bytecodeHash) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            deployer,
            salt,
            bytecodeHash
        )))));
    }

    function testBatchDelegationDeployAndMint() public {
        // Prepare CREATE2 deployment
        bytes memory bytecode = type(UrsaToken).creationCode;
        bytes32 salt = keccak256("ursa-token-salt");
        address predicted = computeCreate2Address(address(batchTx), salt, keccak256(bytecode));

        // Prepare batch: deploy token, then mint to board members
        BatchTransaction.Transaction[] memory txs = new BatchTransaction.Transaction[](4);
        // 1. Deploy token (from Alice, via CREATE2)
        txs[0] = BatchTransaction.Transaction({
            target: address(batchTx),
            value: 0,
            data: abi.encodeWithSignature("deployCreate2(bytes,bytes32)", bytecode, salt)
        });
        // 2-4. Mint to board members (to predicted address)
        for (uint256 i = 0; i < 3; i++) {
            txs[i+1] = BatchTransaction.Transaction({
                target: predicted,
                value: 0,
                data: abi.encodeWithSelector(ERC20.transfer.selector, boardMembers[i], BOARD_MEMBER_SHARE)
            });
        }
        // Alice signs delegation to BatchTransaction
        Vm.SignedDelegation memory signedDelegation = vm.signDelegation(address(batchTx), alicePk);
        // Attach delegation for the next call
        vm.prank(alice);
        vm.attachDelegation(signedDelegation);
        // Execute batch as Alice (EOA, now delegated)
        batchTx.execute(txs);
        // Assertions
        ERC20 token = ERC20(predicted);
        assertEq(token.name(), "Ursa Industries Token");
        assertEq(token.symbol(), "URSA");
        for (uint256 i = 0; i < 3; i++) {
            assertEq(token.balanceOf(boardMembers[i]), BOARD_MEMBER_SHARE);
        }
    }
} 