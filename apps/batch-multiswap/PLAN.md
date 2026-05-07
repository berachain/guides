# Bera Batch Swapper Recreation Plan

## 1. Project Goal

Recreate a frontend-only Vite application that lets a connected MetaMask wallet batch swap multiple Berachain ERC-20 token balances into BERA in one atomic wallet batch.

The app:

- Connects to MetaMask on Berachain mainnet.
- Detects ERC-5792 atomic batch support with `wallet_getCapabilities`.
- Loads Berachain token metadata and wallet ERC-20 balances.
- Fetches token USD prices from CoinGecko.
- Lets the user select multiple token balances and adjust per-token swap amounts.
- Debounces KyberSwap route quote requests for each selected token.
- Rebuilds fresh KyberSwap calldata at execution time.
- Checks ERC-20 allowances with Multicall3.
- Prepends exact `approve` calls when allowance is insufficient.
- Sends all approval and swap calls through `wallet_sendCalls` with `atomicRequired: true`.
- Polls `wallet_getCallsStatus` until the batch succeeds, fails, or times out.

There is no backend service and no local smart contract package. All contract interactions are performed from the browser through the connected wallet and Berachain RPC.

## 2. Core User Flow

1. User opens the app.
2. User connects MetaMask.
3. App asks MetaMask for ERC-5792 capabilities.
4. App verifies the wallet is connected to Berachain mainnet.
5. App loads the Berachain token list, merges it with curated seed tokens, and reads wallet balances through Multicall3.
6. App fetches USD prices for visible token balances from CoinGecko.
7. User selects one or more tokens.
8. Selecting a token defaults its swap amount to the full wallet balance.
9. User edits amounts if desired.
10. App debounces KyberSwap route quotes per selected token.
11. Swap button enables only when every selected token has an amount and an OK quote.
12. On click, app fetches fresh Kyber routes and build calldata.
13. App checks allowance for each token/router pair.
14. App creates the final ordered call list: optional `approve`, then Kyber router swap, repeated per token.
15. App submits calls with ERC-5792 `wallet_sendCalls`.
16. App polls `wallet_getCallsStatus` every 2 seconds.
17. On success, app links to Berascan and refreshes balances.

## 3. Technology Stack

Use the current project stack for an exact recreation:

- Runtime/package runner: Bun, using `bunx` in scripts.
- Build tool: Vite 5.
- UI: React 18 with TypeScript.
- Styling: Tailwind CSS configured through PostCSS.
- Wallet and chain state: wagmi v2.
- Ethereum primitives and ABI encoding: viem.
- Wallet SDK: `@metamask/sdk`.
- Async query provider: TanStack React Query.
- Client state: Zustand.
- HTTP client: ky.
- Linting: ESLint flat config with `typescript-eslint`, React Hooks, and React Refresh rules.

## 4. Scripts

Recreate these scripts in `package.json`:

```json
{
  "dev": "bunx vite",
  "build": "bunx tsc && bunx vite build",
  "preview": "bunx vite preview",
  "lint": "bunx eslint src --ext ts,tsx"
}
```

Expected local commands:

```sh
bun install
bun run dev
bun run build
bun run lint
```

There is currently no test runner configured.

## 5. Target Directory Structure

```text
batch-multiswap/
|-- index.html
|-- package.json
|-- postcss.config.js
|-- tailwind.config.js
|-- tsconfig.json
|-- tsconfig.node.json
|-- vite.config.ts
|-- eslint.config.js
|-- public/
|-- dist/
`-- src/
    |-- App.tsx
    |-- index.css
    |-- main.tsx
    |-- vite-env.d.ts
    |-- wagmi.ts
    |-- components/
    |   |-- CapabilityBadge.tsx
    |   |-- SwapButton.tsx
    |   |-- SwapSummary.tsx
    |   |-- TokenList.tsx
    |   |-- TokenRow.tsx
    |   `-- TransactionStatus.tsx
    |-- hooks/
    |   |-- useERC5792.ts
    |   |-- useKyberSwap.ts
    |   |-- useSwapBatch.ts
    |   |-- useTokenBalances.ts
    |   `-- useWallet.ts
    |-- lib/
    |   |-- berachain.ts
    |   |-- erc20.ts
    |   |-- erc5792.ts
    |   |-- kyberswap.ts
    |   |-- permit2.ts
    |   |-- prices.ts
    |   `-- tokenList.ts
    |-- store/
    |   `-- swapStore.ts
    `-- types/
        |-- erc5792.ts
        |-- kyberswap.ts
        `-- token.ts
```

## 6. Configuration Files

### Vite

Create `vite.config.ts` with the React plugin only. Keep it minimal unless deployment requires a custom base path.

### TypeScript

Use strict TypeScript settings:

- `strict: true`
- `allowJs: false`
- `moduleResolution: "Bundler"`
- `jsx: "react-jsx"`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`

### ESLint

Use a flat ESLint config that:

- Ignores `dist`.
- Applies recommended JS and TypeScript rules.
- Enables browser globals.
- Enables React Hooks rules.
- Enables React Refresh's `only-export-components` warning with constant exports allowed.

### Styling

Use `src/index.css` for Tailwind directives and a full-height root:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  min-height: 100%;
}
```

The recreated UI should keep the same dark zinc/amber visual language:

- Page background: dark zinc gradient.
- Primary action: amber button.
- Success: emerald.
- Warnings/errors: yellow/red bordered cards.
- Layout: centered max-width container with token list and summary/action column.

## 7. Chain Constants

Implement `src/lib/berachain.ts` first because most other modules depend on it.

Required constants:

- Chain id: `80094`
- Chain name: `Berachain`
- Native currency: `BERA`, 18 decimals.
- RPC URL: `https://rpc.berachain.com`
- Explorer: `https://berascan.com`
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11`
- WBERA: `0x6969696969696969696969696969696969696969`
- Native BERA marker: `0x0000000000000000000000000000000000000000`
- ERC-5792 chain id hex: derive with viem `numberToHex(berachain.id)`.

Also include curated seed tokens so the app still works if the remote token list fails:

- HONEY
- WBTC
- WETH
- USDC.e
- USDT
- sWBERA
- iBGT
- BGT

Each token needs address, symbol, name, decimals, logo URI, and optional CoinGecko id.

## 8. App Bootstrap

Implement `src/main.tsx`:

1. Instantiate `MetaMaskSDK` in the browser with dapp metadata:
   - name: `Bera Batch Swapper`
   - url: `window.location.href`
   - `injectProvider: true`
2. Create a TanStack `QueryClient`.
3. Disable `refetchOnWindowFocus` by default.
4. Render the app inside:
   - `React.StrictMode`
   - `WagmiProvider`
   - `QueryClientProvider`

Implement `src/wagmi.ts`:

1. Create wagmi config with the Berachain chain only.
2. Add the `metaMask` connector with the same dapp metadata.
3. Use HTTP transport for Berachain RPC.
4. Register the wagmi config type via module augmentation.

## 9. Type Models

Create small, focused type files.

### `types/token.ts`

Define:

- `Token`
- `TokenWithBalance`
- `SelectedToken`

Keep balances as `bigint` internally and formatted balances as strings for display.

### `types/kyberswap.ts`

Model the subset of Kyber responses the app uses:

- `RouteSummary`
- route hops
- extra fee metadata
- routes response
- build response
- build calldata data

The app only needs `amountIn`, `amountOut`, USD fields, gas fields, route data, router address, and calldata.

### `types/erc5792.ts`

Model:

- capability map keyed by hex chain id.
- `atomic` and legacy `atomicBatch` capability shapes.
- wallet calls with `to`, `data`, and optional `value`.
- `SendCallsParamsV2` with `version: "2.0.0"`, `chainId`, `calls`, `capabilities`, and `atomicRequired`.
- call status result with status code, optional transaction hash, receipts, reason, and message.
- `ERC5792RpcError`.

## 10. Data and API Libraries

### ERC-20 Helpers

In `lib/erc20.ts`:

- Encode exact `approve(spender, amount)` calldata with viem `encodeFunctionData` and `erc20Abi`.
- Optionally keep an `approve max` helper for future use.
- Export contract call objects for:
  - `balanceOf(owner)`
  - `allowance(owner, spender)`

These are consumed by viem `publicClient.multicall`.

### ERC-5792 RPC Helpers

In `lib/erc5792.ts`:

- Cast the EIP-1193 provider to a minimal extended provider that accepts arbitrary request methods.
- Implement `walletGetCapabilities(provider, address)`.
- Implement `walletSendCalls(provider, params)`.
- Implement `walletGetCallsStatus(provider, batchId)`.
- Normalize thrown wallet errors into `ERC5792RpcError`.
- Parse `wallet_sendCalls` responses that may return a string id or an object containing `id`, `callsId`, or `batchId`.
- Parse `wallet_getCallsStatus` defensively and extract a transaction hash from common shapes, including nested receipt objects.

### KyberSwap Client

In `lib/kyberswap.ts`:

- Use base URL `https://aggregator-api.kyberswap.com/berachain/api/v1`.
- Create a ky client with:
  - `baseUrl: "<base>/"`
  - header `x-client-id: bera-batch-swapper`
  - timeout `30_000`
- Implement `fetchKyberRoute`:
  - GET `routes`
  - `tokenIn`: selected token
  - `tokenOut`: WBERA
  - `amountIn`: token amount in wei
  - `saveGas: false`
  - `gasInclude: true`
  - return `routeSummary` or `null`
- Implement `buildKyberCalldata`:
  - POST `route/build`
  - include route summary, sender, recipient, slippage bps, and deadline
  - return calldata, router address, amount out, and gas
- Implement `computePriceImpactRatio` as `(amountInUsd - amountOutUsd) / amountInUsd`, clamped to zero when data is invalid.

### Token List

In `lib/tokenList.ts`:

- Fetch `https://raw.githubusercontent.com/berachain/metadata/main/src/tokens/mainnet.json`.
- Convert valid chain `80094` ERC-20 entries into local `Token` objects.
- Reject native zero address and invalid addresses.
- Merge remote tokens over seed tokens by lowercase address.
- Return seed tokens if the network request fails.

### Prices

In `lib/prices.ts`:

- Query `https://api.coingecko.com/api/v3/simple/token_price/berachain`.
- Pass lowercase contract addresses joined by commas.
- Request `vs_currencies=usd`.
- Return a lowercase-address-to-USD-price map.
- Return an empty map on failure so balances still render.

### Permit2 Placeholder

Keep `lib/permit2.ts` as a documented placeholder only. The current app intentionally uses standard ERC-20 approvals.

## 11. Zustand Store

Implement `store/swapStore.ts` as the central UI state.

State to include:

- `batchCapability`
  - `loading`
  - `supported`
  - `not_supported`
  - `upgrade_required`
  - `wrong_network`
  - `error`
- `amountByToken`
  - lowercase token address to wei decimal string.
- `selectedTokens`
  - `Set<string>` of lowercase addresses.
- `quotes`
  - per-token quote status and route data.
- `swapPhase`
  - `idle`
  - `fetching_routes`
  - `awaiting_wallet`
  - `pending`
  - `success`
  - `error`
- `batchId`
- `lastError`
- `successTxHash`
- `pollWarning`
- `balanceRefreshNonce`

Actions to include:

- set batch capability.
- set token amount.
- toggle token selected.
- replace selected token set.
- set and clear quotes.
- set swap phase.
- set batch id.
- set last error.
- set success transaction hash.
- set poll warning.
- bump balance refresh nonce.
- reset transient swap UI.

Use immutable updates for objects and create a new `Set` when changing selections.

## 12. Hooks

### `useWallet`

Responsibilities:

- Read account, connector, chain id, connection state, and wagmi status.
- Connect to the MetaMask connector when available.
- Fall back to the first connector if MetaMask is missing.
- Disconnect wallet.
- Switch to Berachain.
- Expose `wrongChain`.
- Resolve the active EIP-1193 provider from the wagmi connector.

### `useERC5792`

Split into three hooks:

- `useERC5792Capabilities`
- `useERC5792Execution`
- `useERC5792CapabilitySync`

Capability detection:

1. If disconnected, set capability to `loading`.
2. If no provider is available, set capability to `error`.
3. If connected to the wrong chain, set capability to `wrong_network`.
4. Call `wallet_getCapabilities`.
5. Find the entry whose hex key equals Berachain chain id.
6. Support both `atomic` and `atomicBatch`.
7. Classify:
   - `supported: true`, `status: "supported"`, or `status: "ready"` -> `supported`
   - missing chain entry or missing atomic capability -> `upgrade_required`
   - explicit unsupported -> `not_supported`

Execution:

- `sendCalls(calls)` should construct:
  - `version: "2.0.0"`
  - `chainId: BERACHAIN_CHAIN_ID_HEX`
  - `calls`
  - `capabilities: {}`
  - `atomicRequired: true`
- `getCallsStatus(batchId)` should call the ERC-5792 status helper.

Sync:

- Refresh capabilities when address, connection status, or chain id changes.

### `useTokenBalances`

Responsibilities:

- Skip when owner or public client is missing.
- Fetch the merged token list.
- Read balances through `publicClient.multicall`.
- Chunk balance multicalls in groups of 120.
- Drop failed calls and zero balances.
- Format balances with viem `formatUnits`.
- Fetch USD prices for nonzero balances.
- Compute USD value and sort:
  - highest USD value first.
  - symbol alphabetically as tie breaker.
- Refetch when `balanceRefreshNonce` changes.
- Abort work on unmount.

### `useKyberSwap`

Expose wrappers around:

- `fetchKyberRoute`
- `buildKyberCalldata`
- `computePriceImpactRatio`

Also implement `useDebouncedRouteQuotes`:

- Watch selected tokens and amount-by-token.
- Use one timer and one `AbortController` per selected token.
- Debounce quote requests by 400ms.
- Set quote status to `idle` when amount is blank or zero.
- Set quote status to `loading` before a request.
- On success, store:
  - `amountOutWei`
  - `gasEstimate`
  - `priceImpactRatio`
  - `routeSummary`
- On no route, store `no_route`.
- On errors, store `error`.
- Abort removed token quote requests without affecting other selected tokens.

### `useSwapBatch`

This is the main execution hook.

Constants:

- `SLIPPAGE_BPS = 50`
- `DEADLINE_SEC = 300`
- `VALUE_ZERO = "0x0"`

Execution algorithm:

1. Require connected address and public client.
2. Require Berachain.
3. Require `batchCapability === "supported"`.
4. Require at least one selected token.
5. Require every selected token to have a nonzero amount.
6. Clear previous error and set phase to `fetching_routes`.
7. Switch to Berachain if needed.
8. Set deadline to current unix time plus 300 seconds.
9. Fetch fresh Kyber routes for all selected tokens in parallel.
10. Build Kyber calldata for all valid routes in parallel.
11. Mark invalid routes in quote state.
12. If nothing valid remains, set error.
13. Multicall current allowance for each token/router pair.
14. Build final wallet calls:
    - If current allowance is below amount, add ERC-20 `approve(router, amount)`.
    - Add Kyber router swap calldata.
15. Set phase to `awaiting_wallet`.
16. Send calls through `wallet_sendCalls`.
17. Store returned batch id.
18. Set phase to `pending`.
19. On errors, normalize message and set phase to `error`.

The order of calls matters. Approvals must appear before the corresponding router swap.

## 13. Components

### `App.tsx`

Composition only:

- Sync ERC-5792 capability.
- Read connected address.
- Start debounced route quotes.
- Load token balances.
- Render:
  - header
  - wallet connect button
  - capability badge
  - token list
  - swap summary
  - swap button
  - transaction status when connected

### `WalletConnect.tsx`

Recreate as the wallet control component:

- Show connect button when disconnected.
- Show connected address in shortened form.
- Show disconnect control.
- Show switch-network button or warning when on the wrong chain.
- Surface connect or switch errors where useful.

### `CapabilityBadge.tsx`

Render the capability state:

- Disconnected: prompt to connect.
- Loading: checking state.
- Supported: strong success badge.
- Wrong network: Berachain warning.
- Not supported: wallet unsupported warning.
- Error: capability check failed.
- Upgrade required: button linking to `https://metamask.io/flask/`.

### `TokenList.tsx`

Render:

- Loading skeleton rows.
- Error card.
- Empty state.
- Token rows for each nonzero balance.

### `TokenRow.tsx`

Per-token responsibilities:

- Checkbox selection.
- Token logo, symbol, name, formatted balance, and USD value.
- Decimal amount input.
- Max button.
- Clamp entered amount to wallet balance.
- Store values as wei decimal strings.
- Show quote status:
  - loading skeleton.
  - estimated BERA out when OK.
  - no route warning.
  - error message.

### `SwapSummary.tsx`

Show:

- Total estimated BERA out by summing OK quotes.
- Total estimated gas from route estimates.
- Price impact warning if any quote has impact over 2%.
- Batch support warning if capability is unsupported, upgrade required, wrong network, or errored.

### `SwapButton.tsx`

Gate execution:

- Connected wallet.
- Correct chain.
- Supported ERC-5792 atomic batch capability.
- At least one selected token.
- Every selected token has a nonzero amount and OK quote.

Labels by phase:

- `idle`: `Swap All to BERA`
- `fetching_routes`: `Getting fresh quotes...`
- `awaiting_wallet`: `Confirm in wallet...`
- `pending`: `Swapping... (polling)`
- `success`: `Swap Complete`
- `error`: retry label

On error click, reset phase to idle and clear last error. Otherwise call `executeSwap`.

### `TransactionStatus.tsx`

Poll the ERC-5792 batch:

- Poll every 2 seconds while phase is `pending`.
- Timeout after 3 minutes.
- Interpret status codes:
  - `100`: pending.
  - `200`: success.
  - `400`: failure.
- On success:
  - extract transaction hash from result or first receipt.
  - set phase to `success`.
  - clear warnings.
  - bump balance refresh nonce.
  - reset transient UI after 5 seconds.
- On failure:
  - set phase to `error`.
  - show reason or message.
- Link successful transaction hashes to `https://berascan.com/tx/<hash>`.

## 14. External Services and Runtime Assumptions

No `.env` file is required for the current implementation. These values are hard-coded:

- Berachain RPC: `https://rpc.berachain.com`
- KyberSwap API: `https://aggregator-api.kyberswap.com/berachain/api/v1`
- Kyber client id header: `bera-batch-swapper`
- Berachain token list: `https://raw.githubusercontent.com/berachain/metadata/main/src/tokens/mainnet.json`
- CoinGecko token price API: `https://api.coingecko.com/api/v3/simple/token_price/berachain`
- Berascan: `https://berascan.com`

If recreating this for production hardening, consider moving these into `VITE_*` environment variables, but keep the current constants for a faithful rebuild.

## 15. Blockchain Behavior

The app does not deploy or own contracts.

It relies on:

- ERC-20 `balanceOf`.
- ERC-20 `allowance`.
- ERC-20 `approve`.
- Multicall3 reads.
- Kyber router calldata returned by KyberSwap.
- MetaMask ERC-5792 wallet RPC methods.

Important invariants:

- Kyber routes settle to WBERA because the Kyber Berachain API does not accept native BERA zero address for `tokenOut`.
- Swap transaction `value` is always `0x0` because inputs are ERC-20 tokens.
- Approval amount is exact selected amount in the current app.
- The final batch must be atomic, so `atomicRequired` is `true`.
- Fresh routes and calldata are fetched at click time to avoid sending stale route summaries.

## 16. Error Handling Strategy

Keep errors user-facing and actionable:

- Missing wallet -> connect wallet first.
- Wrong chain -> switch to Berachain.
- Unsupported batching -> explain ERC-5792 atomic batch requirement.
- Quote failure -> per-token quote status.
- No route -> per-token no-route status.
- Build calldata failure -> mark quote error and stop if no valid swaps remain.
- Wallet RPC failure -> show normalized wallet error.
- Poll timeout -> tell user to check wallet.
- Batch failure -> show wallet status reason/message where available.

Avoid crashing the UI when token metadata, price lookups, or individual multicall rows fail.

## 17. Validation Checklist

After recreating the project, run:

```sh
bun run lint
bun run build
```

Manual browser checks:

- App loads without console errors.
- MetaMask SDK initializes.
- Connect button opens MetaMask.
- Connecting requests Berachain.
- Wrong-chain state appears when wallet is on another chain.
- Capability badge changes after connection.
- Token list loads nonzero balances.
- Token rows default selected amount to max balance.
- Amount input accepts decimals and clamps to balance.
- Debounced quotes appear for selected tokens.
- Swap button stays disabled until all selected tokens have OK quotes.
- Swap click asks MetaMask for an ERC-5792 batch.
- Batch contains approvals before swaps when allowances are insufficient.
- Pending status polls every 2 seconds.
- Success displays a Berascan link.
- Balances refresh after success.

## 18. Known Gaps and Future Improvements

Current project gaps to preserve or improve consciously:

- No automated tests.
- No `.env.example`.
- No backend proxy for Kyber/CoinGecko rate limits.
- No explicit slippage UI; slippage is fixed at 50 bps.
- No permit flow; Permit2 is only a placeholder.
- No native BERA input swaps; this is ERC-20 positions into BERA/WBERA.
- No custom error taxonomy beyond user-facing strings.
- Build output exists in `dist`, but source files are the authoritative recreation target.

Recommended future work:

- Add Vitest tests for quote state, capability classification, and ERC-5792 response parsing.
- Add integration tests with mocked EIP-1193 provider responses.
- Add configurable slippage and deadline controls.
- Add `.env.example` for endpoints and client ids.
- Add a wallet/provider abstraction test harness for ERC-5792 edge cases.
- Consider Permit2 only if it reduces approval friction without weakening the atomic execution model.

## 19. Build Order

Recreate in this order to reduce rework:

1. Project scaffold, dependencies, scripts, TypeScript, Vite, ESLint, and styling config.
2. Chain constants and token/type models.
3. wagmi config and app bootstrap providers.
4. ERC-20, ERC-5792, KyberSwap, token list, and price libraries.
5. Zustand swap store.
6. Wallet and ERC-5792 hooks.
7. Token balance and quote hooks.
8. Batch execution hook.
9. UI components from the outside in: app shell, wallet, capability badge, token list, token row, summary, button, transaction status.
10. Manual browser validation with MetaMask on Berachain.
11. Lint and production build.
