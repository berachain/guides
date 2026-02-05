# Staking Pool Frontend – Task Brief

Cleanup and bug-fix pass for the staking pool reference implementation frontend.

---

## Critical Bug: Withdrawal Badge Shows for Wrong Validator

### Symptom

The Withdraw tab badge (pending count) appears even when viewing a pool where the user has no pending withdrawals for that validator.

### Browser Validation (2026-02-05)

| Context | Expected | Actual |
|---------|----------|--------|
| Pool 0x15aa Stake/Withdraw | Badge "1" | Badge "1" (correct) |
| Discover tab (no pool) | No badge | Badge "1" (wrong) |
| Pool 0x5904 Stake/Withdraw (no withdrawal) | No badge | Badge "1" (wrong) |

### Root Cause

1. **Badge visible on Discover:** `tabs` computed in `App.vue` always includes `withdrawals.pendingCount.value` regardless of which tab is active.
2. **Stale data on pool switch:** When the user selects a different pool, `withdrawals.loadWithdrawalRequests()` is not called; the count remains from the previous pool.

### Fix

1. Pass `badge: null` when `activeTab === 'discover'` or no pool is selected.
2. Watch for `poolAddress` / `poolConfig.validatorPubkey` changes and call `withdrawals.loadWithdrawalRequests()`.

### Test to Add

```js
test('withdrawal badge hidden on Discover tab', async ({ page }) => {
  // Setup: user has pending withdrawal for validator A
  // Navigate to Discover
  // Assert: badge is null/hidden
})

test('withdrawal badge reloads on pool switch', async ({ page }) => {
  // Setup: user has withdrawal for pool A, none for pool B
  // View pool A → badge shows
  // Switch to pool B → badge disappears
})
```

---

## Prioritized Issue List

### P0 – Correctness Bugs

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| 1 | Withdrawal badge shows on Discover | `App.vue` L145-149 | See above |
| 2 | Withdrawal data not reloaded on pool change | `App.vue` watchers | See above |

### P1 – Testability / Regression Prevention

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| 3 | No E2E test for badge visibility rules | `tests/basic.spec.js` | Add per validation plan |
| 4 | No E2E test for pool-switch data reload | `tests/basic.spec.js` | Add per validation plan |

### P2 – Architectural Debt

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| 5 | Monolithic App.vue (~560 lines) | `src/App.vue` | Split into smaller composables or use a router |
| 6 | Global wallet state outside composable | `useWallet.js` L4-9 | Refs defined at module scope; fine for single instance but leaks across tests |
| 7 | No centralized state / event bus | throughout | Prop drilling and emit chains 3+ levels deep |
| 8 | Manual URL state sync | `App.vue` L156-186, L481-491 | Fragile; consider vue-router |

### P3 – Code Smells

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| 9 | Magic strings for tabs | `App.vue`, `TabNav.vue` | Use constants or enum |
| 10 | Duplicate `formatNumber` / `shortAddress` logic | `useStakingPool.js`, `PoolDetailHeader.vue`, `PoolListView.vue` | Extract to `utils/format.js` |
| 11 | Inconsistent error handling | composables | Some set `error.value`, others just `console.error` |
| 12 | `previewTimeout` mutable closure | `StakeCard.vue`, `WithdrawCard.vue` | Works but easy to leak; consider `useDebounce` |
| 13 | `hasPosition` check compares formatted strings | `PositionCard.vue` L35-37 | Should compare raw BigInt |
| 14 | `lastDelayVault` mutable in composable | `useWithdrawals.js` L17 | Easy to get stale; reset on pool change |
| 15 | No input validation for stake/withdraw amounts | `StakeCard.vue`, `WithdrawCard.vue` | User can enter negative or NaN |

### P4 – Polish / DX

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| 16 | No TypeScript | everywhere | Typos in props silently ignored |
| 17 | Console.log/warn statements in production code | composables | Should be stripped or use logger |
| 18 | Theme CSS duplicated across example files | `public/` | Use CSS variables more aggressively |
| 19 | Test helper embeds historical data | `pool-scenarios.js` | Fine for reproducibility but may confuse maintainers |

---

## Validation Plan Summary

See `dev-docs/VALIDATION_PLAN.md` for full details.

### Scenarios to Cover

1. Badge hidden on Discover (no pool context)
2. Badge shown on Stake/Withdraw for pool where user has pending withdrawal
3. Badge hidden on Stake/Withdraw for pool where user has no withdrawal
4. After switching pool, badge reflects new pool's count

### Pool Types to Include

- Active pool (e.g. 0x15aa, 0x5904)
- Exited pool (e.g. 0x15c0, 0x7e25)
- Dead pool (e.g. 0x2c88)
- User with pending withdrawal (e.g. 0x15aa #28)
- User with ready withdrawal (finalize flow)
- User with no withdrawal for that validator

---

## Suggested Implementation Order

1. **Fix badge visibility** (P0 #1) – trivial; compute badge conditionally.
2. **Reload withdrawals on pool change** (P0 #2) – add watcher.
3. **Add E2E tests** (P1 #3-4) – cover both badge rules.
4. **Manual validation** – run through validation plan in browser.
5. **Refactor formatNumber / shortAddress** (P3 #10) – quick win for hygiene.
6. **Fix hasPosition string compare** (P3 #13) – prevents subtle display bugs.
7. **Address remaining P3/P4** – as time permits.

---

## Files to Touch

| File | Changes |
|------|---------|
| `src/App.vue` | (1) compute badge conditionally, (2) add watcher for pool change |
| `tests/basic.spec.js` | Add badge visibility tests |
| `tests/helpers/pool-scenarios.js` | Add scenario: user with withdrawal for one pool, none for another |
| `src/utils/format.js` | Consolidate `formatNumber`, `shortAddress` |
| `src/components/stake/PositionCard.vue` | Compare BigInt instead of formatted string |

---

## Commit Strategy

1. `fix(badge): hide withdrawal badge when not viewing a pool`
2. `fix(badge): reload withdrawals on pool change`
3. `test(badge): add E2E tests for withdrawal badge visibility`
4. `refactor(format): consolidate formatNumber and shortAddress`
5. `fix(position): compare BigInt instead of formatted string`

---

## Definition of Done

- Badge only appears on Stake/Withdraw for validators where user holds a withdrawal token.
- Switching pools reloads withdrawal data for the new pool.
- E2E tests pass for all badge scenarios.
- Manual validation plan completed (document results in `VALIDATION_PLAN.md`).
