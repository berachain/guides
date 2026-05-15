# TwoFactorAccount — P-256 2FA Smart Contract Demo

This project demonstrates a two-factor smart contract account pattern using an owner secp256k1 wallet signature plus a P-256 signature verified through the EIP-7951 `P256VERIFY` precompile. It is useful context for EIP-7702-style delegated account flows where a browser wallet authorizes intent and a second factor signs the same intent before a relayer submits execution.

## Prerequisites

- Bun
- A browser wallet such as MetaMask
- A WebAuthn-capable browser and platform authenticator such as Touch ID, Face ID, or Windows Hello

## Quickstart

```bash
bun install
cp .env.example .env
bun run contracts:build
bun dev
```

## Configuration

RPC URLs are configured from the root `.env` file and exposed to the Vite app with `VITE_` variables. Start by copying `.env.example`:

```bash
cp .env.example .env
```

Then edit any RPC URL as needed:

```bash
VITE_ETHEREUM_MAINNET_RPC_URL=https://cloudflare-eth.com
VITE_ETHEREUM_SEPOLIA_RPC_URL=https://1rpc.io/sepolia
VITE_BERACHAIN_MAINNET_RPC_URL=https://rpc.berachain.com
VITE_BERACHAIN_BEPOLIA_RPC_URL=https://bepolia.rpc.berachain.com
```

## Build Contract Artifacts

The contract artifact build runs Solc against `apps/contracts/src/TwoFactorAccount.sol` and writes TypeScript exports for the frontend:

- `apps/contracts/src/abi.ts` exports `twoFactorAccountAbi`
- `apps/contracts/src/bytecode.ts` exports `twoFactorAccountBytecode`

Run the contract build directly from the repo root:

```bash
bun run contracts:build
```

Run the full production build, including regenerated contract artifacts and the Vite app:

```bash
bun run build
```

Useful root commands:

```bash
bun run web:dev
bun run web:build
bun run typecheck
```

## Hardware P-256 Key Registration

The web app registers a platform WebAuthn credential with `navigator.credentials.create`. The authenticator creates the P-256 key inside device-backed secure hardware, and the app only receives the public key coordinates needed for contract deployment. No P-256 private key is generated, entered, stored, or held in application state.

## Usage

1. Deploy: connect the primary wallet, register the hardware key, confirm the extracted P-256 public key coordinates, then deploy `TwoFactorAccount`.
2. Sign: enter the target, amount, and call data. First sign the intent with the owner wallet, then sign the same stored intent with the WebAuthn hardware key. The app only creates the relay-ready pending signature bundle after both signatures are complete.
3. Relay: connect the secondary wallet and submit `execute()` with the stored signatures. On success, clear and reset the local demo state.

## localStorage Keys

| Key                      | Contents                                                    |
| ------------------------ | ----------------------------------------------------------- |
| `tfa_contract_address`   | Deployed contract address string                            |
| `tfa_credential_id`      | Base64url-encoded WebAuthn credential ID                    |
| `tfa_signature_draft`    | In-progress wallet and P-256 signature draft for one intent |
| `tfa_pending_signatures` | JSON object with all signing outputs                        |

## Supported Networks

| Network                   | Chain ID | P256VERIFY status in app       |
| ------------------------- | -------: | ------------------------------ |
| Ethereum Mainnet          |        1 | Supported                      |
| Ethereum Sepolia Testnet  | 11155111 | Warning: may not support 0x100 |
| Berachain Mainnet         |    80094 | Supported                      |
| Berachain Bepolia Testnet |    80069 | Warning: may not support 0x100 |

## EIP-7951 Status

EIP-7951 is still a draft. The P-256 verification precompile is deployed on Berachain mainnet and some L2s, but it is not yet broadly available on Ethereum mainnet.
