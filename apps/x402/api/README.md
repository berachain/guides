# weather-x402

A Hono service that gates a US weather forecast endpoint behind an [x402](https://x402.org) paywall, denominated in **HONEY** on **Berachain**, and settled gaslessly through the [Thirdweb x402 facilitator](https://portal.thirdweb.com/x402/facilitator).

## Endpoints

| Method | Path       | Paywall | Description                                               |
| ------ | ---------- | ------- | --------------------------------------------------------- |
| GET    | `/health`  | no      | Liveness check.                                           |
| GET    | `/geocode` | no      | `?city=...` — Nominatim lookup returning `{lat, lon}`.    |
| GET    | `/weather` | yes     | `?lat=&lon=` — `api.weather.gov` forecast, paid in HONEY. |

## Payment flow

1. Client calls `GET /weather?lat=...&lon=...` without a payment header.
2. Server responds `402 Payment Required` with x402 `accepts` requirements (amount, HONEY token, `payTo`, chain).
3. Client signs an ERC-2612 `permit` over the HONEY amount and retries with `X-PAYMENT` header.
4. Thirdweb facilitator verifies the signature and submits the HONEY transfer on Berachain gaslessly via EIP-7702 using your server wallet.
5. Server returns the weather JSON.

Any x402-capable client works (e.g. `wrapFetchWithPayment` / `useFetchWithPayment` from `thirdweb`).

## Setup

```bash
bun install
cp .env.example .env   # then edit .env
bun run dev
```

### Required env vars (see [.env.example](.env.example))

| Var                              | Notes                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `RPC_URL`                        | Defaults to `https://rpc.berachain.com` (mainnet).                               |
| `CHAIN_ID`                       | `80094` for Berachain mainnet, `80069` for Bepolia testnet.                      |
| `CHAIN_NAME`                     | Human-readable chain name, e.g. `berachain`.                                     |
| `HONEY_CONTRACT_ADDRESS`         | Mainnet HONEY: `0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce`.                     |
| `HONEY_DECIMALS`                 | `18`.                                                                            |
| `HONEY_AMOUNT`                   | Human-readable amount charged per call, e.g. `0.1`.                              |
| `PAY_TO_ADDRESS`                 | Wallet that receives the HONEY.                                                  |
| `THIRDWEB_SECRET_KEY`            | Project secret key from the Thirdweb dashboard.                                  |
| `THIRDWEB_SERVER_WALLET_ADDRESS` | Server wallet address from the Thirdweb dashboard (executes the HONEY transfer). |
| `PORT`                           | HTTP port, default `3000`.                                                       |

## Quick test

### 1. Start the server

```bash
bun run dev
# weather-x402 listening on http://localhost:3000
```

### 2. Hit the free endpoints

```bash
curl -s http://localhost:3000/health
# {"ok":true}

curl -s "http://localhost:3000/geocode?city=San%20Francisco"
# {"lat":37.7879363,"lon":-122.4075201,"displayName":"San Francisco, California, United States"}
```

### 3. Trigger the 402 (no payment yet)

```bash
curl -i "http://localhost:3000/weather?lat=37.7749&lon=-122.4194"
```

Response (x402 v2 `PaymentRequired` envelope):

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
```

```json
{
  "x402Version": 2,
  "error": "X-PAYMENT header is required",
  "resource": {
    "url": "http://localhost:3000/weather?lat=37.7749&lon=-122.4194",
    "description": "Access to US weather forecast, priced at 0.1 HONEY",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:80094",
      "amount": "100000000000000000",
      "asset": "0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce",
      "payTo": "0xYourPayToAddress",
      "maxTimeoutSeconds": 3600,
      "extra": { "name": "HONEY", "version": "1" }
    }
  ],
  "extensions": {}
}
```

Everything a client needs to pay is in `accepts[0]`:

| Field               | Example value                                | What it is                                                                            |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scheme`            | `exact`                                      | Use EIP-3009 `transferWithAuthorization` (or ERC-2612 `permit`) for the exact amount. |
| `network`           | `eip155:80094`                               | CAIP-2 chain id. `80094` = Berachain mainnet, `80069` = Bepolia testnet.              |
| `amount`            | `100000000000000000`                         | Atomic units. For `0.1 HONEY` at 18 decimals → `parseUnits("0.1", 18)`.               |
| `asset`             | `0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce` | HONEY ERC-20 contract on Berachain.                                                   |
| `payTo`             | `PAY_TO_ADDRESS` from `.env`                 | Recipient of the HONEY.                                                               |
| `maxTimeoutSeconds` | `3600`                                       | Signature validity window.                                                            |

### 4. Perform the payment (recommended: Thirdweb client)

The simplest way to pay is to wrap `fetch` with Thirdweb's x402 client helper, which reads the 402, signs the authorization with a connected wallet, and retries with the `X-PAYMENT` header automatically.

```ts
import { createThirdwebClient } from "thirdweb";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { privateKeyToAccount } from "thirdweb/wallets";

const client = createThirdwebClient({ clientId: "<your-thirdweb-client-id>" });
const account = privateKeyToAccount({
  client,
  privateKey: process.env.PAYER_PRIVATE_KEY!, // wallet holding HONEY + (optionally) BERA
});

const payFetch = wrapFetchWithPayment(fetch, client, account);

const res = await payFetch(
  "http://localhost:3000/weather?lat=37.7749&lon=-122.4194",
);
console.log(await res.json());
console.log("receipt:", res.headers.get("x-payment-response"));
```

Run it with `bun run pay.ts`. On success:

- The server returns the weather JSON.
- The response includes an `X-PAYMENT-RESPONSE` header — base64-encoded JSON matching the v2 `SettlementResponse` schema:
  ```json
  {
    "success": true,
    "transaction": "0x...",
    "network": "eip155:80094",
    "payer": "0xPayerWallet"
  }
  ```
  Decode with `atob(res.headers.get("x-payment-response"))`.

### 5. Perform the payment manually (curl)

For debugging, you can build the `X-PAYMENT` header yourself. It is a base64-encoded JSON `PaymentPayload` per the [x402 v2 spec §5.2](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md#52-paymentpayload-schema).

```ts
// sign-payment.ts — sketch, run with: bun run sign-payment.ts
import { createWalletClient, http, parseUnits, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { randomBytes } from "node:crypto";

const berachain = defineChain({
  id: 80094,
  name: "berachain",
  nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.berachain.com"] } },
});

const HONEY = "0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce";
const payTo = "0xYourPayToAddress";
const amount = parseUnits("0.1", 18).toString(); // "100000000000000000"

const account = privateKeyToAccount(
  process.env.PAYER_PRIVATE_KEY as `0x${string}`,
);
const wallet = createWalletClient({
  account,
  chain: berachain,
  transport: http(),
});

const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address,
  to: payTo,
  value: amount,
  validAfter: String(now - 10),
  validBefore: String(now + 3600),
  nonce: toHex(randomBytes(32)),
};

const signature = await wallet.signTypedData({
  domain: {
    name: "HONEY",
    version: "1",
    chainId: 80094,
    verifyingContract: HONEY,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: authorization,
});

const paymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: "exact",
    network: "eip155:80094",
    amount,
    asset: HONEY,
    payTo,
    maxTimeoutSeconds: 3600,
    extra: { name: "HONEY", version: "1" },
  },
  payload: { signature, authorization },
  extensions: {},
};

const header = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
console.log(header);
```

Then:

```bash
HEADER="$(bun run sign-payment.ts)"
curl -i "http://localhost:3000/weather?lat=37.7749&lon=-122.4194" \
  -H "X-PAYMENT: $HEADER"
```

On success you get the weather JSON plus the `X-PAYMENT-RESPONSE` receipt header. On failure the server returns another 402 with an `error` field — common reasons: `insufficient_funds`, `invalid_exact_evm_payload_signature`, or `invalid_exact_evm_payload_authorization_valid_before` (clock skew).

### Pre-flight checklist before paying

- Payer wallet holds at least `HONEY_AMOUNT` HONEY on the same chain as `CHAIN_ID`.
- `PAY_TO_ADDRESS` and `THIRDWEB_SERVER_WALLET_ADDRESS` in `.env` are distinct — revenue lands on the former, the latter only broadcasts.
- The Thirdweb server wallet has a small amount of native BERA for gas (EIP-7702 reduces but does not eliminate gas costs).
- `THIRDWEB_SECRET_KEY` has x402 access enabled in the Thirdweb dashboard for the chosen network.

## x402 spec compliance

This service conforms to the [x402 v2 protocol specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md):

- Responds with HTTP `402 Payment Required` when `X-PAYMENT` is missing or invalid.
- Emits the canonical v2 envelope: `{ x402Version: 2, error, resource, accepts, extensions }`.
- Uses CAIP-2 network identifiers (`eip155:<chainId>`).
- Advertises `scheme: "exact"` backed by EIP-3009 `TransferWithAuthorization` (HONEY also supports ERC-2612 `permit`, which the Thirdweb facilitator accepts as an alternative).
- Returns the settlement receipt as a base64-encoded `SettlementResponse` in the `X-PAYMENT-RESPONSE` header on successful paid requests.
- Verification + settlement are delegated to the [Thirdweb facilitator](https://portal.thirdweb.com/x402/facilitator), which implements the v2 `/verify`, `/settle`, and `/supported` endpoints.

## Notes

- HONEY must support **EIP-3009** or **ERC-2612 permit** for the Thirdweb facilitator to settle payments. If a non-permit token is required, swap `HONEY_CONTRACT_ADDRESS` in `.env` — no code changes needed.
- The Thirdweb facilitator uses your server wallet via EIP-7702 so the payer does not need native BERA for gas.
- No private keys live in this service; all signing is brokered by Thirdweb via `THIRDWEB_SECRET_KEY` + `THIRDWEB_SERVER_WALLET_ADDRESS`.

## Stack

- [Bun](https://bun.com/) runtime + package manager
- [Hono](https://hono.dev/) HTTP framework
- [thirdweb](https://www.npmjs.com/package/thirdweb) x402 facilitator + `settlePayment`
- [viem](https://viem.sh/) chain definition + `parseUnits`
- [zod](https://zod.dev/) env + query validation
