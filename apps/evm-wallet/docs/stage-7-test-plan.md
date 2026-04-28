# Stage 7 Test Plan — EVM address derivation

Stage 7 derives the primary EVM address at `m/44'/60'/0'/0/0`, persists it in
the wallet index and manifest, and displays it in the wallets list.

## Simulator

1. Rebuild the dev client after prebuild.
2. Generate a local wallet. The wallets list shows an EIP-55 `0x...` address.
3. Tap **Copy** and paste elsewhere. The clipboard contains the full address.
4. Confirm the displayed address is truncated in the middle.
5. Generate an iCloud-backed wallet. The address appears without biometric
   prompts on simulator.
6. Restore from iCloud. Addresses appear on restored wallets without prompts.
7. Confirm each derived address passes `isValidEvmAddress`.
8. Cross-check at least one mnemonic against MetaMask, ethers, or viem using
   path `m/44'/60'/0'/0/0`.

## Device

1. Generate a local wallet.
2. Tap through the local-only warning. One biometric/passcode prompt appears
   at commit time with "Authenticate to set up your wallet".
3. Cancel the prompt. The wallet is not committed and the user can retry or
   cancel the pending wallet.
4. Retry and authenticate. The wallet appears with an address.
5. Generate an iCloud-backed wallet. Tapping **Finish** shows one prompt with
   "Authenticate to create your wallet"; it covers both iCloud migration and
   address derivation.
6. Restore from iCloud. The screen shows progress and prompts once per wallet.
7. Cancel one restore prompt. Choose **Continue** to skip that wallet, then
   verify the remaining wallets continue restoring.

## Migration

1. Launch with an existing Stage 6b MMKV index or schema-1 manifest.
2. The app does not crash; wallets without addresses show "Address pending...".
3. Tap **Derive address**. Authenticate if prompted. The row updates with the
   address and the manifest is rewritten as schema version 2.

## Sensitive Data

While testing, stream logs and verify there is no mnemonic, seed hex, private
key, or raw derived key material:

```bash
xcrun simctl spawn booted log stream --predicate 'processImagePath contains "walletapp"'
```
