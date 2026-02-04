# Staking Pool Frontend Test Plan

## Automated Tests (Playwright)

Run with: `npm run test:e2e` or `npm run test:e2e:ui` for interactive mode

**Basic Tests** (`tests/basic.spec.js`):
- ✅ Page loads without errors
- ✅ Pool stats display (Total Staked, Exchange Rate, Pool Status)
- ✅ Wallet connect button visible when disconnected
- ✅ Tab navigation works (Stake, Withdraw)
- ✅ Delegation badge appears/disappears correctly
- ✅ Wallet connection flow (enhanced mock wallet)
- ✅ User position display when wallet connected
- ✅ Wallet balance display
- ✅ Stake input interaction
- ✅ Pool status display

**Pool Scenario Tests (Single Pool Design):**
- ✅ Normal pool: user with position and withdrawals (ready + pending)
- ✅ Exited pool: user can view but cannot stake
- ✅ Pending pool: not yet active (below activation threshold)

**To Add:**
- Stake transaction flow (with mock wallet)
- Withdrawal request creation flow
- Withdrawal finalization flow (ready requests)
- Batch withdrawal finalization
- Error states (invalid pool address, RPC failures)

## Manual Testing Checklist

### Setup
- [ ] Config loads from `public/config.json`
- [ ] Network detection works (bepolia/mainnet)
- [ ] Pool address resolves correctly
- [ ] Delegation handler auto-queries from factory (if exists)

### Pool Data Loading
- [ ] Total staked displays correctly
- [ ] Exchange rate calculates and displays (1 BERA = X stBERA)
- [ ] Pool status shows correctly (Active/Inactive/Exited)
- [ ] Data refreshes every 15 seconds
- [ ] Handles RPC errors gracefully

### Delegation Badge
- [ ] Badge appears when delegation exists
- [ ] Badge formats correctly ($50K, $1.2M)
- [ ] Badge hidden when no delegation
- [ ] Badge hidden when handler not found

### Wallet Connection
- [ ] Connect button works
- [ ] Wallet address displays when connected
- [ ] Disconnect works
- [ ] Network switching handled (if needed)

### Stake Flow
- [ ] Amount input accepts numbers
- [ ] MAX button fills wallet balance (minus gas)
- [ ] Preview shows expected shares
- [ ] Stake button disabled when appropriate
- [ ] Transaction submits successfully
- [ ] Success message shows with explorer link
- [ ] Balance updates after stake

### Withdrawal Flow
- [ ] Amount input works
- [ ] Preview shows expected BERA
- [ ] Request creates withdrawal request
- [ ] Pending requests display in queue
- [ ] Countdown timer works
- [ ] Finalize button enables when ready
- [ ] Batch finalize works for multiple requests

### Error Handling
- [ ] Invalid pool address shows error
- [ ] RPC failures handled gracefully
- [ ] Network errors logged to console
- [ ] User sees helpful error messages

## Test Pool Configuration

**Bepolia Test Pool:**
- Pubkey: `0xa6ce5adefe9d089ffd772297d77d147beff8fa8bf3c1b5a6b8ff204fc168a026968278214a8dd1624cb5947bb009d70f`
- Staking Pool: `0x15aA5162f4c7915edc209296Cd366eBb4658c520`
- Withdrawal Vault: `0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4`
- Network: Bepolia (chainId 80069)

## Running Tests

```bash
# Start dev server manually
npm run dev

# In another terminal, run tests
npm run test:e2e

# Or run with UI
npm run test:e2e:ui
```

## Test Scenarios

### Scenario 1: First-Time User
1. Open frontend (not connected)
2. Verify pool stats load and display
3. Click "Connect Wallet"
4. Approve connection in wallet
5. Verify address displays in header
6. Check position shows 0 shares if no stake
7. Verify wallet balance displays

### Scenario 2: Staking Flow
1. Connect wallet with BERA balance
2. Enter stake amount (e.g., 1 BERA)
3. Verify preview shows expected shares
4. Click "Stake"
5. Approve transaction in wallet
6. Wait for confirmation
7. Verify success message with explorer link
8. Verify position updates
9. Verify wallet balance decreases

### Scenario 3: Withdrawal Flow
1. Connect wallet with stBERA shares
2. Navigate to Withdraw tab
3. Enter withdrawal amount
4. Verify preview shows expected BERA
5. Click "Request Withdrawal"
6. Approve transaction
7. Verify request appears in queue
8. Wait for countdown (or test with ready request)
9. Click "Finalize" when ready
10. Verify BERA received in wallet

### Scenario 4: Multiple Withdrawals
1. Create multiple withdrawal requests
2. Verify all appear in queue
3. Wait for multiple to be ready
4. Use "Finalize All" batch action
5. Verify all finalized in single transaction

### Scenario 5: Error Cases
1. Test with invalid pool address (should show error)
2. Test with RPC failure (should handle gracefully)
3. Test stake with insufficient balance (should disable button)
4. Test stake with pool exited (should show error)
5. Test withdrawal with no shares (should show empty state)

## Browser Compatibility

Test in:
- Chrome/Chromium (primary)
- Firefox
- Safari (if available)

## Network Testing

- Bepolia testnet (current config)
- Mainnet (change config.json chainId to 80094)

## Performance Checks

- [ ] Page loads in < 3 seconds
- [ ] Pool data loads in < 5 seconds
- [ ] Wallet connection completes in < 2 seconds
- [ ] Transaction preview updates in < 1 second
- [ ] No console errors on initial load
- [ ] No memory leaks during extended use

## Accessibility

- [ ] Keyboard navigation works
- [ ] Screen reader compatible (basic)
- [ ] Color contrast meets WCAG AA
- [ ] Focus indicators visible

## Known Issues

- Delegation handler query may fail silently if handler doesn't exist (expected behavior)
- ~~Wallet connection requires browser extension (can't fully test in headless mode)~~ → **Fixed:** Mock wallet implemented for testing
- Network switching not yet implemented (user must manually switch in wallet)

## Mock Wallet Testing

Enhanced mock wallet system with live bepolia pool data scenarios:

**Location:** `tests/helpers/mock-wallet-enhanced.js` and `tests/helpers/pool-scenarios.js`

**Features:**
- Custom balance mocking
- Contract read mocking (pool state, user shares, withdrawal requests)
- Transaction result mocking
- Live pool data from bepolia snapshot (2026-01-27)

**Pool Scenarios (Single Pool Design):**
- **Normal Pool:** Active pool with user position and withdrawals (some ready, some pending)
- **Exited Pool:** Exited pool - user can view/withdraw but cannot stake
- **Pending Pool:** Pool hasn't reached activation threshold (isActive = false)

**Usage:**
```javascript
import { TestPoolScenarios, createPoolScenario } from './helpers/pool-scenarios.js'
import { installEnhancedMockWallet, TEST_ACCOUNT, bepolia } from './helpers/mock-wallet-enhanced.js'

const scenario = TestPoolScenarios.normalWithPosition
const mockConfig = createPoolScenario(scenario.pool, {
  ...scenario.userState,
  userAddress: TEST_ACCOUNT.address
})

await installEnhancedMockWallet({
  page,
  account: TEST_ACCOUNT,
  defaultChain: bepolia,
  mocks: mockConfig
})
```

**Mock Data Includes:**
- User BERA balance
- User stBERA shares in pool
- ERC721 withdrawal tokens (withdrawal requests)
- Pool state (totalAssets, totalSupply, isActive, isFullyExited)
- Withdrawal request readiness (based on requestBlock + finalization delay)

## Test Data

**Test Wallet (Bepolia):**
- Use a test wallet with bepolia BERA
- Ensure sufficient balance for gas + staking
- Can use faucet if needed

**Expected Pool State:**
- Pool should be active
- Exchange rate should be > 1.0 (1 BERA = X stBERA where X > 1)
- Total staked should be visible
