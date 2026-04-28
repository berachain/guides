# Stage 9 Test Plan — RPC Management

Stage 9 stores user-defined RPC network configurations in MMKV. It does not
make network requests or validate RPC connectivity.

## Empty State

1. Fresh install or dev reset.
2. Open Settings → Networks.
3. Confirm "No networks configured" appears with an **Add a network** button.
4. Return to wallets list. The active network pill says "No network configured"
   and tapping it opens the add-network screen.

## Add Networks

1. Add Ethereum Mainnet:
   - Name: `Ethereum Mainnet`
   - RPC URL: `https://eth.llamarpc.com`
   - Chain ID: `1`
   - Currency symbol: `ETH`
   - Explorer: `https://etherscan.io`
2. Confirm it appears in the list and is active by default.
3. Add Arbitrum One:
   - Name: `Arbitrum One`
   - RPC URL: `https://arb1.arbitrum.io/rpc`
   - Chain ID: `42161`
   - Currency symbol: `ETH`
   - Explorer: `https://arbiscan.io`
4. Confirm it appears but Ethereum remains active until selected.

## Active Network

1. Tap Arbitrum in Settings → Networks. Confirm the active indicator moves.
2. Open wallets list. Confirm the active network pill shows `Arbitrum One · ETH`.
3. Tap the pill. Select Ethereum Mainnet from the action sheet.
4. Confirm the pill updates immediately.

## Edit And Delete

1. Edit Ethereum Mainnet and rename it. Confirm the new name persists.
2. Change its chain ID and save. Confirm the edited chain ID appears.
3. Delete a non-active network with the confirmation dialog. Active network
   should not change.
4. Delete the active network while another remains. Active switches to the
   first remaining network.
5. Delete the last network. Active becomes `null` and wallets list shows the
   add-network empty state.

## Validation

1. Submit empty required fields. Errors appear.
2. Enter an invalid RPC URL. Error appears.
3. Enter `http://localhost:8545`. Warning appears but submission is allowed.
4. Enter chain IDs `0`, `-1`, `1.5`, `01`. Each is rejected.
5. Enter lowercase currency symbol. It auto-uppercases.
6. Enter invalid block explorer URL. Error appears only if the field is non-empty.

## Persistence

1. Add two networks and select the second as active.
2. Force-quit and relaunch.
3. Confirm both networks and the active selection persist.
4. Uninstall/reinstall. Confirm networks are gone; they are MMKV-only and not
   synced to iCloud.
