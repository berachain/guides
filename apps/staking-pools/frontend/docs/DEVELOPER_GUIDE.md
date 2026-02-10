# Developer Guide

Reference for the staking pool frontend codebase. The app is a Vue 3 SPA with no router and no global store; state lives in `App.vue` and composables.

## Getting Started

```bash
npm install
npm run dev    # dev server (Vite, default port 3001)
npm run build  # output in dist/
```

## Architecture Overview

```
App.vue (layout + orchestration)
  - Loads config, initializes wallet chain, applies URL state
  - Owns: activeTab, poolAddress, poolConfig, refs for composables
  - Passes refs/computed into composables; handles stake/withdraw events
  - URL state: ?tab=stake|withdraw|discover|nosy &pool=0x... &pubkey=0x... (nosy tab requires config.nosyMode)
  - Periodic refresh (visibility-aware) and popstate for back/forward
        |
        +-- useWallet()           -> account, connect, disconnect, publicClient, walletClient
        +-- useStakingPool(...)   -> pool data, user position, stake, previewDeposit/previewRedeem
        +-- useWithdrawals(...)   -> withdrawal requests, requestRedeem, finalize
        +-- usePoolDiscovery(...) -> pools list (config or API), discoverPools
        |
        v
Views: StakeView, WithdrawView, PoolListView
  - Receive props from App; emit events (stake, requestRedeem, finalize, connect, etc.)
  - No direct composable use; all wiring in App.vue
```

There is no `src/router/` or `src/stores/`. Navigation is tab-based via `activeTab`; deep links use query params and `applyUrlState` in App.vue.

## URL State

The app syncs UI state to the URL so links can open a specific tab and pool.

- **Read:** `getUrlState()` returns `{ tab, pool, pubkey }` from `?tab=&pool=&pubkey=`.
- **Write:** `writeUrlState({ tab, pool, pubkey }, 'push'|'replace')` updates the URL.
- **Apply:** `applyUrlState(state)` sets `activeTab`, selects pool when `state.pool` and `state.pubkey` are present (both validated: pool as Ethereum address, pubkey as 98-char hex). After applying, pool data and optional delegation handler are loaded.

Pool and pubkey from the URL are validated with `isValidAddress(pool)` and `isValidValidatorPubkey(pubkey)` before use; invalid values are ignored.

## Error Handling

### Shared utilities (`src/utils/errors.js`)

- **parseError(err)** — Normalizes thrown errors and contract revert messages into a consistent shape for the UI (e.g. `{ message, summary }`). Use in catch blocks before setting component error state or passing to ErrorDisplay.
- **ValidationError**, **PoolStateError** — Optional typed errors for validation or pool-state failures; `parseError` can recognize them and set a friendly summary.

### In composables

Throw plain `Error` or use typed errors. Components (or App.vue) catch and pass the result through `parseError` before displaying.

### In components

Use the shared **ErrorDisplay** component for a consistent error UX (summary, optional technical details, dismiss, optional retry). Pass the result of `parseError(err)` as the `error` prop. Alternatively, keep inline error UI (as in StakeCard) but still use `parseError` so messaging is consistent.

### Global error handler (`main.js`)

`app.config.errorHandler` is set to log unhandled component errors. You can extend it to send to an error-tracking service (e.g. Sentry) using `parseError` for a consistent payload.

## File Layout

```
src/
  App.vue              # Root: config, URL state, composables, tab layout, event handlers
  main.js              # Bootstrap + global error handler
  theme.css            # Design tokens and base styles
  components/
    common/            # WalletConnect, TabNav, StatCard, PoolDetailHeader, ErrorDisplay
    stake/             # StakeCard, PositionCard
    withdraw/          # WithdrawCard, WithdrawQueue
  composables/         # useWallet, useStakingPool, useWithdrawals, usePoolDiscovery
  constants/           # addresses (incl. isValidAddress, isValidValidatorPubkey), chains, thresholds
  utils/               # config (loadConfig, loadTheme), format, abis, errors
  views/               # StakeView, WithdrawView, PoolListView
```

## Adding a New View or Tab

1. Add a new view component under `src/views/`.
2. In App.vue: add a tab id (e.g. in `tabs` computed and `normalizeTab`), a `v-else-if` branch for the new tab, and any new event handlers that delegate to composables.
3. If the view needs URL state, extend `getUrlState` / `writeUrlState` / `applyUrlState` (and optionally add query params) so the new tab is restorable from a link.

## Common Patterns

### Loading state

```js
const isLoading = ref(false);
async function fetchData() {
  isLoading.value = true;
  try {
    // ...
  } finally {
    isLoading.value = false;
  }
}
```

### Error + retry (with ErrorDisplay)

```js
import { parseError } from "../utils/errors.js";
import ErrorDisplay from "../components/common/ErrorDisplay.vue";

const error = ref(null);
async function operation() {
  error.value = null;
  try {
    // ...
  } catch (err) {
    error.value = parseError(err);
  }
}
function retry() {
  error.value = null;
  operation();
}
```

```vue
<ErrorDisplay :error="error" :on-retry="retry" @dismiss="error = null" />
```

### Wallet check before actions

Components receive `isConnected` from App.vue (from `wallet.isConnected.value`). Disable actions or show "Connect Wallet" when not connected; stake/withdraw handlers in App.vue assume wallet is connected when the user triggers them (composables throw if not).

### Preview before submit

Stake and withdraw flows call `pool.previewDeposit(amount)` or `pool.previewRedeem(shares)` and show the result before the user confirms. Handlers in App.vue call the composable preview methods and pass results back to the card components.

## Testing

### Unit tests (Vitest)

- **utils/format.js** — `validateAmount`, `formatNumber`, `calculateExchangeRate`, `formatTimeRemaining`, etc.
- **constants/addresses.js** — `isValidAddress`, `isValidValidatorPubkey`, `normalizeAddress`, `isZeroAddress`.
- Optionally: composable return shapes or pure helpers used by composables.

Run: `npm run test` (or `npm run test:unit` if script is added).

### E2E tests (Playwright)

- **tests/basic.spec.js** — Single-pool flows: load, connect wallet, stake tab, withdraw tab, position display, pool scenarios (normal, exited, pending), discovery and pool selection, URL state.
- **tests/helpers/** — Mock wallet and pool scenario helpers.

Run: `npm run test:e2e`.

## Style and Conventions

- **Components:** PascalCase (`StakeCard.vue`).
- **Composables:** camelCase with `use` prefix (`useWallet.js`).
- **Utils:** camelCase (`parseError`, `formatNumber`).
- **Constants:** SCREAMING_SNAKE_CASE in `constants/` (`ZERO_ADDRESS`).
- **Component structure:** `<template>` then `<script setup>` (imports, props/emits, refs/computed, methods, lifecycle) then `<style scoped>`.

## Pitfalls

- **Don’t use pool or pubkey from the URL without validating.** Use `isValidAddress(pool)` and `isValidValidatorPubkey(pubkey)` in `applyUrlState` and anywhere else URL or external input is used to set pool state.
- **Don’t forget to handle errors in async handlers.** Catch, run through `parseError`, and set component error state or pass to ErrorDisplay so the user sees a consistent message.
- **Don’t mutate refs that App.vue owns (e.g. poolAddress) from a view without going through the intended flow.** Pool selection should go through the handler that updates poolConfig and delegation handler (e.g. `handleSelectPool` or URL apply).

## Debugging

- Vue DevTools: inspect component tree and refs; no Pinia or Router tabs.
- Console: initialization and RPC errors are logged; global error handler logs unhandled component errors.
- Network: config.json and RPC calls; check CORS if RPC fails from the browser.
