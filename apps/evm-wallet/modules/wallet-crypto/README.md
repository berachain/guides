# `wallet-crypto`

Local Expo native module (Swift, iOS only). Owns BIP39 mnemonic generation,
per-wallet Keychain storage, AES-256-GCM mnemonic encryption, and Secure
Enclave key wrapping so secrets are never generated or held in the
JavaScript runtime outside of the explicit reveal screen, and the local
storage form is hardware-bound and biometric-gated.

## Security boundary

The module exposes JS-visible wallet storage functions. `revealMnemonic`
returns plaintext words for the reveal UI. Stage 7 also exposes BIP39 seed
hex for address derivation; the seed is equivalent to the mnemonic in
security terms and must never be persisted or logged.

| Function                                                | Returns                    | Crosses bridge?             |
| ------------------------------------------------------- | -------------------------- | --------------------------- |
| `generateAndStoreMnemonic(icloudBackedUp)`              | wallet id (UUID string)    | id only                     |
| `revealMnemonic(id, prompt?)`                           | mnemonic string (24 words) | **plaintext — intentional** |
| `deleteMnemonic(id)`                                    | void                       | none                        |
| `mnemonicExists(id)`                                    | boolean                    | boolean only                |
| `setMnemonicSyncState(id, icloudBackedUp, prompt?)`     | void                       | none                        |
| `deriveSeedFromMnemonic(id, prompt)`                    | 64-byte seed hex           | **seed — temporary**        |
| `setSyncStateAndDeriveSeed(id, icloudBackedUp, prompt)` | 64-byte seed hex           | **seed — temporary**        |

Inside Swift, sensitive buffers (raw entropy, the mnemonic UTF-8 bytes,
the AES-256 data-protection key, the AES-GCM ciphertext while it is still
a `var`, any intermediate plaintext during sync-state migration, and the
derived BIP39 seed) are zeroed via `memset_s` on function exit.

The `Data` buffer returned by `SecItemCopyMatching` is owned by
CoreFoundation and cannot be reliably zeroed from Swift — we minimize its
lifetime by letting it go out of scope immediately after the UTF-8 to
String conversion in `revealMnemonic`.

## Stage 6b storage model — dual-mode

Each wallet is stored in exactly one of two shapes, chosen at generation
time by the `icloudBackedUp` argument and migratable later via
`setMnemonicSyncState`:

### Local / Secure-Enclave-wrapped (`icloudBackedUp == false`)

| Keychain artifact      | Content                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `wallet.se.<id>`       | Secure Enclave P-256 private key, non-exportable.                                                            |
| `wallet.aeskey.<id>`   | ECIES ciphertext of the AES-256 data-protection key, wrapped with the SE public key.                         |
| `wallet.mnemonic.<id>` | AES-256-GCM ciphertext of the mnemonic (CryptoKit "combined" format: `nonce(12) ‖ ciphertext(N) ‖ tag(16)`). |

All three items are `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. None
sync to iCloud — the SE private key that decrypts the wrapped AES key is
non-exportable and device-bound, so a synced wrapped-AES blob on a
different device would be worthless.

Simulator builds are an explicit development exception: because iOS
Simulator cannot reliably evaluate Secure Enclave
DeviceOwnerAuthentication access control, `WalletCryptoModule` routes public
local-wallet operations through the plaintext Keychain path under
`#if targetEnvironment(simulator)`. That keeps onboarding testable, but it is
not equivalent to the device security boundary.

**Reveal triggers a biometric (or device-passcode) prompt.** The prompt
is presented by iOS when `SecKeyCreateDecryptedData` is called with the
SE private key (ECIES decrypt includes an ECDH step that touches the
private key). `deleteMnemonic`, `mnemonicExists`, and the initial write
do NOT prompt.

Access control: `[.privateKeyUsage, .userPresence]`.

- `.userPresence` allows Face ID / Touch ID OR the device passcode. We
  intentionally do **not** use `.biometryCurrentSet`, which would
  invalidate the SE key every time the user adds or removes a biometric
  enrollment. For an MVP that has no recovery UI yet, that behavior
  would lock users out of their wallet on routine biometric changes
  (e.g. re-enrolling Face ID with glasses). The `.userPresence` choice
  matches the guarantee iCloud Keychain itself uses. Stage 4b's
  passphrase layer will let us revisit this.

### iCloud / plaintext-synced (`icloudBackedUp == true`)

| Keychain artifact      | Content                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `wallet.mnemonic.<id>` | Plaintext UTF-8 mnemonic, `kSecAttrAccessibleAfterFirstUnlock` + `kSecAttrSynchronizable = true`. |

This is the Stage 6 storage shape, retained unchanged. **No biometric
prompt on reveal.** The item's only protection is iCloud Keychain's own
end-to-end encryption and the device unlock state.

This is a deliberate MVP trade-off: SE wrapping cannot coexist with
cross-device sync without a user passphrase (the wrapped AES key has no
decryptor on a new device). Stage 4b (post-MVP) will add a
passphrase-derived KEK so the iCloud path gets encryption at rest
beyond iCloud Keychain's own, and can once again require user input on
reveal.

### Path selection on read

`revealMnemonic` probes `wallet.aeskey.<id>`:

- present → SE-wrapped path: unwrap, decrypt, return.
- absent → plaintext path: read, return. This also handles pre-Stage-6b
  local wallets (`icloudBackedUp == false`, plaintext at `wallet.mnemonic.<id>`),
  which never had a wrapped AES key. Those wallets keep working without
  a biometric prompt on reveal.

Simulator builds skip the wrapped-AES probe in the public module and always
use the plaintext path.

### Migration (`setMnemonicSyncState`)

Switching sync state between storage modes decrypts on the old mode and
re-encrypts on the new mode. Specifically:

- Local → iCloud: biometric prompt (unwrap AES), decrypt mnemonic, delete
  wrapped AES key, write plaintext-synced mnemonic, delete SE key.
- iCloud → local: read plaintext mnemonic, create SE key, wrap a fresh
  AES key, store ciphertext, delete the old plaintext-synced item.

Simulator builds use plaintext for both modes, so `setMnemonicSyncState`
only rewrites the existing plaintext item with the requested synchronizable
flag.

Wallets created before Stage 6b (plaintext, local-only) are **not
auto-migrated**. They continue to work on the plaintext path. Users who
want the SE-wrapped storage for an existing wallet must delete and
regenerate it (i.e. write down a fresh recovery phrase). Auto-migration
is deliberately omitted as a safety foot-gun.

### Seed derivation for EVM addresses

`deriveSeedFromMnemonic(id, prompt)` follows the same storage-path selection
as `revealMnemonic`, but returns the 64-byte BIP39 seed as lowercase hex
instead of returning the mnemonic. The Swift side validates the mnemonic and
derives the seed with CommonCrypto `CCKeyDerivationPBKDF`
(PBKDF2-HMAC-SHA512, 2048 iterations, salt `mnemonic` plus passphrase).

`setSyncStateAndDeriveSeed(id, icloudBackedUp, prompt)` exists to avoid a
double biometric prompt during create-with-iCloud. On the SE path it unwraps
the AES key once, decrypts the mnemonic once, derives the seed, performs the
requested sync-state mutation, and returns the seed hex.

The bridge uses hex rather than raw `Data` so JS can explicitly convert to a
fresh `Uint8Array`, derive the public address, call `seed.fill(0)`, and drop
the string reference. JS strings are immutable and cannot be zeroed, so the
hex string must be kept in the smallest possible scope and never logged.

## Swift source layout

- `ios/BIP39Wordlist.swift` — the 2048-word English wordlist (frozen,
  matches https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt)
  plus a binary-search helper used by `validate`.
- `ios/BIP39.swift` — entropy generation (`SecRandomCopyBytes`),
  SHA-256 checksum (`CryptoKit`), 11-bit group packing, mnemonic
  validation, and BIP39 seed derivation via CommonCrypto PBKDF2. Exposes
  `BIP39.zero(_:)` which the rest of the module
  uses as the single canonical `memset_s` wrapper.
- `ios/AESEncryption.swift` — AES-256-GCM `seal` / `open` via
  `CryptoKit`, plus a 32-byte `randomKey()` helper. Uses CryptoKit's
  `combined` representation as the on-disk format.
- `ios/SecureEnclaveKey.swift` — P-256 SE key lifecycle: `create` / `load` /
  `delete`, plus ECIES `wrapAESKey` / `unwrapAESKey`. The unwrap path is
  the only operation that prompts the user. Error mapping distinguishes
  user-cancel (`errSecUserCanceled`, LAError cancel codes) from hard
  failures.
- `ios/KeychainBridge.swift` — thin wrapper over `SecItemAdd` /
  `SecItemCopyMatching` / `SecItemDelete` for the per-wallet mnemonic
  blob and the SE-wrapped AES key. Service names follow the formats
  `wallet.mnemonic.<uuid>` and `wallet.aeskey.<uuid>`. Keep the mnemonic
  service name in sync with `mnemonicService(id)` in
  `src/lib/storage/secure.ts`.
- `ios/WalletCryptoModule.swift` — Expo `Module` DSL glue plus the
  `MnemonicStorage` helpers that implement the dual-mode flow (fresh
  write, reveal, local↔iCloud migration). All error paths throw Expo
  `Exception` with typed names (`E_USER_CANCELED`, `E_CORRUPT_STATE`,
  `E_NOT_FOUND`, `E_SE_UNWRAP_FAILED`, etc.) that the JS wrapper maps
  into `WalletCryptoError`.
- `ios/Tests/BIP39Tests.swift` — entropy / mnemonic vectors from
  trezor/python-mnemonic.
- `ios/Tests/AESEncryptionTests.swift` — round-trip, tamper, malformed
  ciphertext, and fresh-nonce tests.
- `ios/Tests/SecureEnclaveTests.swift` — key lifecycle and end-to-end
  Stage 6b pipeline. SE-touching tests skip when the current runtime cannot
  evaluate Secure Enclave DeviceOwnerAuthentication. Device validation of
  the real Secure Enclave wrap/unwrap pipeline is a manual step in
  `docs/stage-6b-test-plan.md`.

## Android

`android/` contains the default scaffold from `create-expo-module` and is
intentionally left unused. This project is iOS-only; the Android module
class will not be loaded by the runtime. Do not add Android logic here
without a full security review.

## Running the XCTest suite

The tests are in `ios/Tests/`. They are excluded from the main pod source
set (see the `exclude_files` line in `WalletCrypto.podspec`) so the app
build does not try to compile them as part of the module target.

To run them, open the app workspace and add a new Unit Testing Bundle
target (one-time setup):

```bash
open ios/walletapp.xcworkspace
```

Then in Xcode:

1. File → New → Target → iOS Unit Testing Bundle, name it `WalletCryptoTests`
2. Drag all `.swift` files from `modules/wallet-crypto/ios/Tests/` into
   the new target.
3. Add `WalletCrypto` to the test target's link-with list (Build Phases →
   Link Binary With Libraries)
4. Run `⌘U` (or `xcodebuild test -workspace ios/walletapp.xcworkspace
-scheme WalletCryptoTests -destination 'platform=iOS Simulator,name=iPhone 15'`)

Each test file `@testable import`s `WalletCrypto`, so no source changes
are required.

## Extending the module

Future stages will add more functions (BIP32 derivation, signing). Keep
the rule: secrets stay in Swift `Data`, only the minimum projection
crosses the bridge, and each function is named for its single responsibility.
