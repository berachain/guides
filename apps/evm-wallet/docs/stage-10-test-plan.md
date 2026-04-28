# Stage 10 Test Plan — Balance Fetching

Stage 10 fetches native currency balances for wallet/account addresses using
the active RPC network. It does not fetch token balances, transaction history,
or fiat values.

## Setup

Configure at least one network, for example:

- Name: `Ethereum Mainnet`
- RPC URL: `https://eth.llamarpc.com`
- Chain ID: `1`
- Currency symbol: `ETH`
- Explorer: `https://etherscan.io`

Use one address with a known mainnet balance and one zero-balance address.

## Wallets List

1. Open the wallets list with Ethereum mainnet active.
2. Confirm each wallet row shows a loading skeleton, then the primary account
   native balance with `ETH`.
3. Confirm a zero-balance account displays `0 ETH`.
4. Confirm a tiny positive balance displays `<0.0001 ETH`.
5. Pull to refresh. The spinner appears and balance queries refetch.
6. Turn off network connectivity. Pull to refresh and confirm each row shows
   a balance error indicator.
7. Tap an error indicator and confirm the retry action appears.
8. Re-enable connectivity and pull to refresh. Balances recover.

## Wallet Detail

1. Open a wallet with multiple accounts.
2. Confirm visible accounts show their own loading skeletons and balances.
3. Toggle hidden accounts on. Confirm hidden accounts also fetch balances.
4. Tap the header refresh button. It gives visible feedback and refetches
   balances.
5. If the active network has an explorer URL, tap the `↗` button on an account.
   The system browser opens `${blockExplorerUrl}/address/${address}`.

## Network Switching

1. Configure a second network, such as Arbitrum One.
2. Switch the active network from the wallets-list network pill.
3. Confirm rows show loading states for the new network.
4. Confirm balances are displayed with the new active network's symbol.
5. Switch back and confirm the previous network's cached results do not appear
   under the wrong active network label.

## RPC Hygiene

1. Configure an RPC URL with a path/API key.
2. Trigger an RPC failure.
3. Confirm any user-facing error only shows the hostname if it references the
   URL. Full RPC URLs should not appear in logs or alerts.

## Cross-Validation

For one Ethereum mainnet address, compare:

- App display
- Etherscan
- `viem` in Node or `cast balance <address>`

The wei value should match exactly. Display formatting truncates to four
decimal places, so compare full wei values in the external tool.

## Known Caveat

Chain ID is not verified against the RPC in Stage 10. If a user configures the
wrong chain ID for an RPC URL, the app still queries that URL and may display
balances for the wrong chain.
