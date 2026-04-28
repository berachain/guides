# EVM Wallet App

EVM Wallet App is an iOS-first crypto wallet built as a staged MVP.

This app is built in stages. The current stage is **Stage 11**: local-only wallets are stored as AES-256-GCM ciphertext whose key is wrapped by a per-wallet Secure Enclave P-256 key, each wallet can derive multiple EVM accounts from the same mnemonic, users can manage local RPC networks, view native balances, and send native-currency transactions. Reveal, address derivation, and transaction signing require Face ID / Touch ID / device passcode on physical devices. iCloud-backed wallets remain on the plaintext-with-sync path (see Known limitations).

## Requirements

- macOS. iOS builds and simulators require Xcode.
- Xcode 15+ with an iOS Simulator runtime installed. Recent development has used an iPhone 15 Pro Max simulator.
- [Bun](https://bun.sh) 1.1 or newer. Use Bun for installs and scripts in this repo.
- A development build of the native iOS app. This app includes a local Swift Expo module, so Expo Go is not enough.
- Optional: [EAS CLI](https://docs.expo.dev/eas/) for local development-client builds. Use `bunx eas ...` or the installed dev dependency.
- For physical-device testing: an Apple developer signing setup and a device with Face ID / Touch ID / passcode enabled.
- For transaction testing: a funded EVM testnet account, an RPC URL, and optionally a block explorer URL.

## First-time setup

Install dependencies:

```bash
bun install
```

Create or refresh the iOS native project when native config changes:

```bash
bunx expo prebuild --platform ios
```

Build a simulator development client:

```bash
eas build -p ios --profile development-simulator --local
# Drag the resulting .app onto the iOS Simulator (or use `xcrun simctl install booted path/to/walletapp.app`)
```

Start Metro:

```bash
bun run start
```

Then launch **EVM Wallet** from the simulator home screen, or press `i` from the Metro terminal when a compatible dev client is installed.

The dev client hosts the JS bundle served by Metro (`bun run start`). Hot reload and Fast Refresh work for edits to `app/` and `src/`. Native metadata changes, including the app icon and iOS home-screen title, require rebuilding and reinstalling the dev client.

If Metro logs warnings about `@noble/hashes/crypto.js` while bundling, make
sure dependencies were installed from this app directory with `bun install`,
then restart Metro with a cleared cache:

```bash
bun run start -- --clear
```

The app intentionally disables Metro's package-exports resolver in
`metro.config.js` because `viem`/`ox` pull in Noble packages that need
React Native's file-based fallback resolution.

For a quick local simulator rebuild/install from source:

```bash
bun run ios
```

If iOS keeps showing an old icon or name, uninstall the existing simulator app first:

```bash
xcrun simctl uninstall booted com.walletapp.dev
bun run ios
```

## Scripts

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `bun run start`     | Start the Metro dev server                     |
| `bun run ios`       | Native `expo run:ios` build + simulator launch |
| `bun run lint`      | Biome lint + format check                      |
| `bun run format`    | Biome auto-format                              |
| `bunx tsc --noEmit` | Full TypeScript type-check                     |

## Project structure

The repository directory is still named `wallet-app/`; the user-facing project
name is **EVM Wallet App**.

```text
wallet-app/
├── app/                  # Expo Router routes (file-based)
│   ├── _layout.tsx       # Root Stack navigator + global.css import
│   ├── index.tsx         # Loading / router screen
│   ├── (onboarding)/     # Generate → reveal → confirm → warning flow
│   └── (wallets)/        # Wallet list + header actions
├── src/
│   ├── components/       # Shared UI components (WordGrid, DeleteDialog, Checkbox, styles)
│   ├── hooks/            # Custom React hooks (useMnemonicReader)
│   ├── lib/
│   │   ├── crypto/       # Reserved for future TS wrappers over native crypto (see README)
│   │   ├── storage/      # Keychain (secure.ts, delegates to wallet-crypto) + MMKV (mmkv.ts)
│   │   ├── stores/       # Zustand store(s)
│   │   └── types.ts      # Shared types
├── modules/
│   └── wallet-crypto/    # Local Swift Expo module: BIP39 + Keychain in native code
├── docs/                 # Staging test plans, vectors, and notes
├── ios/                  # Native iOS project (generated via `expo prebuild`, committed)
├── walletappicon.png     # Source app icon used by Expo and iOS
├── app.json              # Expo config (scheme, plugins, typed routes)
├── eas.json              # EAS Build profiles
├── babel.config.js       # babel-preset-expo + nativewind
├── metro.config.js       # Metro with NativeWind + global.css
├── tailwind.config.js    # Tailwind + NativeWind preset
├── global.css            # `@tailwind base/components/utilities`
├── biome.json            # Biome lint + format config
└── tsconfig.json         # TS strict mode + `@/*` alias
```

## EAS Build profiles

Defined in `eas.json`:

- `development-simulator` — iOS Simulator dev client (`bun run start` attaches here)
- `development` — dev client for physical devices
- `preview` — internal distribution build (ad-hoc / TestFlight-style)
- `production` — release build

Build the simulator dev client:

```bash
eas build -p ios --profile development-simulator --local
```

## Native module

`modules/wallet-crypto/` is a local Swift Expo module that owns BIP39
generation and the per-wallet Keychain items. See
[`modules/wallet-crypto/README.md`](./modules/wallet-crypto/README.md) for
the full API, security boundary, and how to run the XCTest suite.

Key points:

- `generateAndStoreMnemonic(icloudBackedUp)` generates entropy with
  `SecRandomCopyBytes`, converts to 24 BIP39 words in Swift, encrypts
  under a fresh AES-256-GCM key (local path only) whose key is wrapped
  by a per-wallet Secure Enclave P-256 key, writes to the Keychain, and
  returns only the new wallet id. No plaintext crosses the bridge here.
- `revealMnemonic(id, prompt?)` is the single explicit bridge crossing
  where plaintext flows into JS — exclusively for display on the reveal
  screen. For Secure-Enclave-wrapped wallets it triggers a biometric /
  passcode prompt (iOS gates the SE key operation).
- `deleteMnemonic(id)` and `mnemonicExists(id)` are void / boolean APIs
  and do not prompt for biometrics.
- `setMnemonicSyncState(id, icloudBackedUp, prompt?)` migrates an
  existing wallet between the local (SE-wrapped) and iCloud
  (plaintext-synced) storage modes. Local → iCloud triggers a biometric
  prompt (to unwrap and re-store). iCloud → local does not.
- `deriveSeedFromMnemonic(id, prompt)` returns a temporary 64-byte BIP39
  seed as hex for JS-side EVM address derivation. The seed is sensitive and
  must never be logged or persisted.
- `setSyncStateAndDeriveSeed(id, icloudBackedUp, prompt)` combines iCloud
  migration and seed derivation so create-with-iCloud uses one prompt.
- Sensitive `Data` buffers in Swift are zeroed via `memset_s` on function
  exit.

## Wallets and addresses

Stage 7 derives one primary EVM account per wallet at `m/44'/60'/0'/0/0`.
The address is persisted as EIP-55 checksummed `0x...` text in MMKV and the
iCloud manifest. Private keys and BIP39 seeds are never stored; JS receives a
temporary seed hex string from the native module, derives the address with
`@scure/bip32`, `@noble/curves` secp256k1, and `@noble/hashes` keccak256,
then zeroes the owned seed byte buffer.

Stage 8 adds multiple EVM accounts under that same mnemonic. Additional
accounts are derived sequentially at `m/44'/60'/0'/0/{index}` and live under
their parent wallet in the detail screen. Accounts can be renamed, set as
primary, or hidden from the default detail view. Hidden is not deletion: the
derivation index, address, name, and hidden flag are preserved for restore.

## Networks

Stage 9 adds local RPC network configuration. A network includes a display
name, RPC URL, chain ID, currency symbol, and optional block explorer URL. The
active network is global for the app and applies to every wallet; it is not
stored per wallet or per account.

Networks are stored in MMKV only. They are not secrets, but they are also not
synced to iCloud in the MVP, so uninstalling the app removes them. Stage 9
does format-only validation and makes no RPC requests; balance fetching and
connection checks start in Stage 10.

## Balances and networks

Stage 10 fetches native currency balances only, using the currently active
network. The wallets list shows each wallet's primary account balance, and the
wallet detail screen shows balances for visible and revealed hidden accounts.
Balances refresh on screen focus when stale, via pull-to-refresh, and through
the manual refresh button on wallet detail. The app does not poll in the
background and does not aggregate balances across networks.

RPC URLs can include API keys, so the app avoids logging full URLs and uses
host-only redaction in user-facing RPC error paths. Network configurations are
local MMKV data and are not synced to iCloud.

`react-native-keychain` remains installed and still handles the iCloud
restore manifest (`wallet.manifest.v1`), which is small, JSON-encoded, and
not worth rewriting in Swift in the same stage.

## Sending transactions

Stage 11 sends native currency only. The send flow validates hex EVM addresses,
estimates gas through the active network RPC, and offers Slow / Normal / Fast
gas presets. Signing happens in JavaScript with viem's local account support,
using a private key derived on demand from the wallet seed and then dropped
after broadcast.

Signing behavior follows the existing Stage 6b storage paths:

- Local wallets on physical devices require biometric/passcode authentication
  because `deriveSeedFromMnemonic` unwraps the Secure-Enclave-protected key
  before Swift derives the BIP39 seed.
- iCloud-backed wallets sign without biometric authentication because their
  synced storage path does not use the Secure Enclave. This is a constraint of
  iCloud Keychain sync with device-bound SE keys, not a missing prompt. Users
  who want biometric gating should use local-only wallets until the future
  passphrase-encrypted iCloud backup feature exists.
- Simulator wallets sign without biometric authentication because simulator
  builds use plaintext Keychain storage. The simulator mode banner remains
  visible as a reminder that this path is for development only.

Transactions are fire-and-forget in this MVP. After broadcast, the app shows
the transaction hash, lets the user copy it, and opens the configured block
explorer at an Etherscan-style `/tx/<hash>` URL when the active network has a
block explorer URL. The app does not poll for confirmations; users verify
status on the block explorer or refresh balances later.

There is no address book, ENS resolution, ERC-20 transfer support, NFT transfer
support, batching, transaction queue, or automatic retry. The destination
address must be pasted as hex for each send.

## Staging plan (what's next)

- **Stage 1** ✅ — BIP39 mnemonic generation
- **Stage 2** ✅ — Full onboarding UX (Zustand, in-memory)
- **Stage 3** ✅ — Secure persistence (iOS Keychain + MMKV)
- **Stage 4** ✅ — iCloud Keychain backup opt-in
- **Stage 5** ✅ — Cancel flow, iCloud restore via synced manifest, screen capture prevention, background blanking, jailbreak advisory
- **Stage 6** ✅ — Native Swift crypto module (`modules/wallet-crypto`): BIP39 + Keychain moved out of JS
- **Stage 6b** ✅ — Secure Enclave wrapping of the AES-256 key that encrypts the mnemonic, biometric gating on reveal, migration between SE-wrapped local and plaintext-synced iCloud modes
- **Stage 7** ✅ — EVM address derivation and address display
- **Stage 8** ✅ — Multiple EVM accounts per mnemonic, account naming, primary account selection, and hide/unhide
- **Stage 4b** (post-MVP) — Passphrase-encrypted backup layer on top of iCloud Keychain (restores biometric-equivalent gating on iCloud-backed wallets)
- **Stage 9** ✅ — Local RPC network management and active network selection
- **Stage 10** ✅ — Native currency balance fetching and display
- **Stage 11** ✅ — Native currency sends with JS-side viem signing
- **Stage 12+** — Receive UX and post-MVP transaction tracking

## Known limitations

- **The app cannot detect whether iCloud Keychain is enabled before a backup is attempted.** iOS does not expose this. If the user toggles on iCloud backup while the system setting is off, the Keychain item is written locally with the synchronizable attribute set; iOS will sync it whenever iCloud Keychain is later enabled. The app cannot tell the user "you opted in but your setting is off".
- **The app cannot confirm that a specific Keychain item has actually finished syncing to iCloud.** iOS does not surface per-item sync state. We record the user's intent (`icloudBackedUp: true`) and trust iOS to handle sync. Cross-device sync delay is typically 30–60 seconds.
- **iCloud Keychain backup is encrypted by Apple's infrastructure, not by a user-supplied passphrase.** Apple cannot read iCloud Keychain items in normal operation (end-to-end encrypted with keys derived from device passcodes), but a user who uses iCloud Keychain Recovery is trusting Apple's recovery process. Stage 4b will add an optional passphrase-encryption layer on top for a stronger trust model.
- **Jailbreak detection uses heuristics and can be bypassed by determined attackers.** The banner is a user advisory, not a security boundary. We surface it because it is a meaningful signal for typical users, not because it is sufficient by itself.
- **Screen recording prevention on iOS captures a black frame.** Screenshots on the reveal screen are blocked by the OS — the user will see a black image and a system notification that the screen is protected. This is Apple's behavior; the library cannot intercept the screenshot action itself.
- **Mnemonic reveal still crosses plaintext into JS memory for display.** Stage 6 eliminates JS-side generation and storage, but the reveal screen by design receives the mnemonic as a JS `string` so it can be rendered. JS strings are immutable, so that copy lingers until GC. Stage 6b adds Secure Enclave wrapping to the at-rest storage and gates reveal on biometrics, but does not change this fundamental display-path constraint.
- **Keychain `Data` returned by `SecItemCopyMatching` cannot be zeroed from Swift.** The buffer is owned by CoreFoundation and freed when the `Data` object is released. The native module minimizes its lifetime by converting to `String` immediately and letting the `Data` go out of scope.
- **iCloud-backed wallets are not Secure-Enclave-wrapped and do not require biometrics to reveal.** Secure Enclave private keys are device-bound and non-exportable; a wrapped AES key synced to iCloud would have no decryptor on a fresh device. For MVP the iCloud path retains the Stage 6 plaintext-with-sync model — its at-rest encryption is whatever iCloud Keychain's own end-to-end encryption provides. Stage 4b (post-MVP) will add a user-supplied passphrase that derives a KEK for the iCloud path, restoring an equivalent of biometric gating.
- **Wallets created before Stage 6b remain on the plaintext storage path.** The native module handles both shapes transparently — legacy wallets continue to work without a biometric prompt on reveal — but they do not benefit from Secure Enclave wrapping. Create a new wallet to use the hardened storage. We deliberately do not auto-migrate; doing so could lose funds if it failed mid-migration.
- **`.userPresence` was chosen over `.biometryCurrentSet` for the SE access control flag.** `.biometryCurrentSet` would invalidate the SE key any time the user re-enrolls a biometric, which without a recovery UI would lock them out of their wallet until they re-imported from the recovery phrase. `.userPresence` allows biometrics OR the device passcode, matching the guarantee iCloud Keychain itself relies on.
- **Address derivation briefly returns the BIP39 seed to JS.** This is equivalent in sensitivity to the mnemonic. The app derives the public address immediately, zeroes the owned `Uint8Array`, and persists only the address. Transaction signing will move fully native in a later stage.
- **Chain ID is not auto-verified against the RPC.** Misconfigured networks can show balances for the wrong chain. Future work: query `eth_chainId` during network setup.
- **Token balances and fiat conversion are not displayed.** Stage 10 shows native currency only.
- **ERC-20 token transfers are not supported.** Stage 11 sends native currency only.
- **Transactions are not tracked after broadcast.** Verify status on the block explorer.
- **ENS names are not resolved.** Use hex EVM addresses only.
- **If the active network is changed mid-send, the transaction draft is invalidated.** Start over on the new active network.
- **Transaction signing happens in JavaScript.** The private key exists in JS memory briefly during signing. A future stage will move signing entirely into Swift via `swift-secp256k1`.
- **iCloud-backed wallets do not require biometric authentication for transaction signing on device.** This is consistent with their storage protection model. A future passphrase-protected iCloud backup feature will restore biometric gating on this path.
- **Simulator transactions sign without biometric authentication.** The simulator mode banner is always visible as a reminder.
