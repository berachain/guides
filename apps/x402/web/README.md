# weather-x402-web

React + wagmi + viem frontend that pays the [`weather-x402`](../weather-x402) API in HONEY on Berachain via the [x402](https://x402.org) protocol.

## Stack

- Vite + React 19 + TypeScript
- wagmi v3 + viem (wallet connection, chain config, typed signing)
- thirdweb `wrapFetchWithPayment` + `viemAdapter` (x402 client handshake)
- MetaMask via wagmi's `injected()` connector

## Setup

```bash
bun install
cp .env.example .env   # edit .env
bun run dev            # http://localhost:5173
```

`weather-x402` must be running on the URL in `VITE_API_BASE_URL` (default `http://localhost:3000`). The backend already has CORS enabled for browser origins.

### Env vars

| Var                       | Notes                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`       | Where the `weather-x402` server is running.                                                    |
| `VITE_THIRDWEB_CLIENT_ID` | Public client id from the Thirdweb dashboard (paired with the server's `THIRDWEB_SECRET_KEY`). |
| `VITE_CHAIN_ID`           | `80094` for Berachain mainnet, `80069` for Bepolia testnet.                                    |

## Flow

1. User clicks **Connect MetaMask** → wagmi `useConnect` with `injected()`.
2. If MetaMask is on the wrong chain, a button appears to call `wallet_switchEthereumChain`.
3. User enters a city → frontend calls `GET /geocode?city=...` (free) on the backend.
4. Frontend calls `GET /weather?lat=...&lon=...` through a paid-fetch wrapper:
   - First response is `402` with x402 v2 payment requirements (HONEY amount, chain, payTo).
   - `thirdweb/x402` builds a payment header using the wagmi/viem wallet client (adapted via `viemAdapter.wallet.fromViem`), prompting MetaMask to sign an ERC-2612 permit / erc-3009 authorization.
   - Request is retried with `X-PAYMENT`. Thirdweb's facilitator settles the HONEY transfer on-chain.
5. UI shows the forecast plus the settlement receipt decoded from the `X-PAYMENT-RESPONSE` header.
