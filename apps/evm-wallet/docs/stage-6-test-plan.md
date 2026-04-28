# Stage 6 Test Plan — Native Swift crypto module

Stage 6 moves BIP39 generation, Keychain writes, and mnemonic reads into a
Swift Expo module at `modules/wallet-crypto/`. `@scure/bip39` is removed;
`src/lib/crypto/entropy.ts` and `src/lib/crypto/mnemonic.ts` are deleted.

These tests verify that the native module works end-to-end and that
behavior from Stages 3–5 (persistence, iCloud backup, cancel flow, restore)
is unchanged from the user's perspective.

## Prerequisites

1. Rebuild the iOS dev client (the native module requires a new binary):
   ```bash
   bunx expo run:ios
   ```
2. Sign into an Apple ID on the simulator/device with iCloud Keychain
   enabled for the iCloud tests.
3. Delete the app before starting each "fresh install" scenario.

## 1. First-time generate and reveal (local-only)

1. Fresh install. Tap **Generate Recovery Phrase**.
2. 24 English BIP39 words appear. Each is a word from the official
   wordlist. Grid numbers 1–24.
3. Check the acknowledgement and tap **Continue**.
4. iCloud toggle defaults to off. Tap **Finish** → warning screen.
5. Acknowledge and tap **I understand, continue**.
6. Wallet appears in list as `Mnemonic #1`, no cloud indicator.
7. Force-quit the app and relaunch. Wallet still present.

## 2. iCloud opt-in after writing down phrase

1. From the wallets list, tap **+**. Tap **Generate Recovery Phrase**.
2. Record the 24 words shown.
3. Acknowledge and tap **Continue**.
4. Toggle iCloud **on**. Tap **Finish**.
5. Wallet appears in list with ☁️ iCloud indicator.
6. (Separate device signed into same Apple ID): open the app, wait ~30s
   for iCloud Keychain sync, re-run steps 1-3 of test 3 below. Expect the
   restore flow to offer this wallet.

Implementation note: `setMnemonicSyncState` reads the existing Keychain
item, deletes the local variant, and re-adds it with
`kSecAttrSynchronizable`. The mnemonic bytes are preserved exactly — the
words the user just wrote down are still valid.

## 3. iCloud restore on fresh install

1. Delete the app from a device with one or more iCloud-backed wallets.
2. Wait ~30s to allow the next-install Keychain sync.
3. Reinstall and launch. Loading screen (500ms minimum) → restore screen.
4. The restore screen lists every manifest entry that was backed up.
5. Tap **Restore wallets**.
6. App navigates to wallets list. All backed-up wallets appear.
7. Delete the app again and reinstall. Repeat step 3. On **Start fresh
   instead**, the restore manifest is left intact in iCloud; only the
   local MMKV index is reset. A subsequent reinstall shows the restore
   screen again.

## 4. Cancel mid-creation — no orphan Keychain entries

This verifies the native module cleanup path. With dev tools open:

1. Tap **Generate Recovery Phrase**.
2. Note the pending wallet id in the dev console (if logged by Zustand
   devtools) or observe that the reveal screen is shown.
3. Tap **Cancel** in the header. Confirm **Discard**.
4. A subsequent call to `WalletCrypto.mnemonicExists(<that id>)` must
   return `false`. (Dev option: add a temporary `__DEV__` button on the
   wallets screen that reads the last pending id from a `useRef` and
   calls the native module. Remove after testing.)

Repeat for cancels from:

- Reveal screen swipe-back gesture
- Confirm screen header-back arrow
- Warning screen swipe-back gesture

Each path must await `cancelPendingCreation`, which calls
`WalletCrypto.deleteMnemonic` on the orphaned id.

## 5. Delete removes Keychain entry

1. Create at least one wallet.
2. Delete it via the trash icon, typing the confirmation phrase.
3. Force-quit and relaunch. Wallet gone from list.
4. If you recorded the id before delete, verify
   `WalletCrypto.mnemonicExists(id)` → `false`.

## 6. Monotonic labels survive mid-list delete

1. Create three wallets. Labels: `Mnemonic #1`, `Mnemonic #2`, `Mnemonic #3`.
2. Delete `Mnemonic #2`.
3. Create one more. It must be labeled `Mnemonic #4` (not `#2`).

## 7. Reveal screen memory hygiene

1. Open any existing wallet's reveal flow (from fresh generation).
2. Navigate away (tap Continue → Back).
3. Expect: on unmount, the reveal screen drops its words array (verified
   by React Profiler showing the state cleanup) and subsequent navigation
   back to reveal triggers a fresh `readMnemonic` call.

## 8. No mnemonic logging

Search the running app's log output during every flow above:

```bash
xcrun simctl spawn booted log stream --predicate 'processImagePath contains "walletapp"' | tee stage6.log
```

Verify `grep -Ei 'mnemonic|entropy|abandon|legal|letter|zoo' stage6.log`
returns no hits from app code. (Matches inside iOS system logs are
acceptable; the concern is our own `console.log` / `print` calls.)

## 9. Regression checks — still green from earlier stages

- Force-quit mid-flow on any onboarding screen: returns to generate (fresh
  install) or wallets list (existing), no orphan data.
- Screen capture attempts on reveal/restore: screenshots are blank.
- App switcher snapshot: background overlay covers screen.
- Jailbreak banner: still shown on a compromised simulator
  (`jail-monkey` simulated mode).
- Input hygiene on DeleteDialog: no keyboard suggestions, no autocorrect.

## 10. BIP39 XCTest vectors

Run the XCTest suite (see `modules/wallet-crypto/README.md`). All eight
entropy-to-mnemonic vectors and the four validation cases must pass:

- `testWordlistIsExactly2048Words`
- `testWordlistIsLexicographicallySorted`
- `testEntropyToMnemonicVectors` (8 vectors)
- `testValidateAcceptsKnownMnemonics`
- `testValidateRejectsBadChecksum`
- `testValidateRejectsUnknownWord`
- `testValidateRejectsBadWordCount`
- `testGenerateProducesValidMnemonic`
- `testGenerateProducesDistinctMnemonics`
- `testGenerateRejectsInvalidEntropyLength`
