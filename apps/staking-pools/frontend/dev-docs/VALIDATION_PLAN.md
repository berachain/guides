# Staking Pool Frontend – Validation Plan

Browser-validated behaviour and regression checklist for the withdrawal badge and key flows.

## Withdrawal tab badge – intended rule

The Withdraw tab badge (pending count) must appear **only** when:

1. The user is viewing the **Stake** or **Unstake (Withdraw)** page for a **specific validator**, and  
2. The user holds at least one **withdrawal token** (pending or ready) for **that validator**.

In all other cases the badge must not appear.

## Scenarios to validate

| # | Context | User state | Badge should show |
|---|--------|------------|-------------------|
| 1 | Discover tab (no pool selected) | Has pending withdrawal for validator A | No |
| 2 | Stake tab, pool A | Has pending withdrawal for validator A | Yes (count) |
| 3 | Withdraw tab, pool A | Has pending withdrawal for validator A | Yes (count) |
| 4 | Stake tab, pool B | No withdrawal for validator B | No |
| 5 | Withdraw tab, pool B | No withdrawal for validator B | No |
| 6 | Discover tab, then select pool A | Has pending withdrawal for A | After selection: show on Stake/Withdraw for A |
| 7 | Pool A (has withdrawal) → switch to pool B (no withdrawal) | As above | No (reload withdrawals for B) |

## Browser validation (2026-02-05)

- **Pool 0x15aa (user has 1 pending withdrawal):** On Stake and Withdraw, tab showed “Withdraw 1” — correct.
- **Discover tab:** Tab still showed “Withdraw 1” — **bug**. Badge should be hidden when not viewing a specific pool.
- **Pool 0x5904 (other validator, no withdrawal):** After selecting from Discover, tab still showed “Withdraw 1” — **bug**. Withdrawals are for 0x15aa; for 0x5904 badge should be 0/hidden. Indicates withdrawals not reloaded on pool change.

## Pool type coverage

Use at least one of each for manual/E2E checks:

- **Active pool** – e.g. 0x15aa, 0x5904 (TVL, accepts stake).
- **Exited pool** – e.g. 0x15c0, 0x7e25 (no new stake, withdraw only).
- **Dead pool** – e.g. 0x2c88 (exited, near-zero TVL).
- **User with pending withdrawal** – e.g. pool 0x15aa with request #28 (~25h remaining).
- **User with ready withdrawal** – finalize flow.
- **User with no withdrawal** – badge must not show on Stake/Withdraw for that pool.

## Implementation fixes implied

1. **Badge visibility:** Only pass a non-null badge when `activeTab` is `'stake'` or `'withdraw'` **and** a pool is selected (`poolAddress` + validator pubkey). When `activeTab === 'discover'` or no pool, badge = null/0 and do not render.
2. **Reload on pool change:** When `poolAddress` or `poolConfig.validatorPubkey` changes, call `withdrawals.loadWithdrawalRequests()` so the count is for the **current** validator; then badge reflects that validator only.

## E2E coverage to add

- Badge hidden on Discover.
- Badge shown on Stake/Withdraw for pool where user has pending withdrawal(s).
- Badge hidden on Stake/Withdraw for pool where user has no withdrawal.
- After switching pool from A (has withdrawal) to B (no withdrawal), badge disappears (withdrawal data reloaded for B).
