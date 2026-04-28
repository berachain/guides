# Stage 8 Test Plan — Multiple Accounts

Stage 8 adds multiple EVM accounts per mnemonic. Accounts use the fixed path
family `m/44'/60'/0'/0/{index}`. Accounts are never deleted individually;
non-primary accounts can be hidden.

## Simulator

1. Create a wallet. The detail screen shows one account, `Account 0`, marked
   primary.
2. Tap **Add account**. `Account 1` appears without a biometric prompt and the
   primary account remains unchanged.
3. Rename `Account 1` to `Trading`. Navigate away and back; the name persists.
4. Set `Trading` as primary. The wallets list immediately shows `Trading` and
   its address.
5. Confirm the action menu does not offer **Hide** on the primary account.
6. Add `Account 2`, hide it, and confirm it disappears from the default list.
7. Toggle **Show hidden accounts**, unhide `Account 2`, and confirm it returns
   to the visible list.
8. Delete the wallet. The wallet and all account metadata disappear.

## iCloud Restore

1. Create a wallet, add two accounts, rename one, hide one, and use an
   iCloud-backed wallet state.
2. Delete/reinstall the app and restore from iCloud.
3. During restore, only the manifest primary account is derived.
4. Open the wallet detail screen. A pending-accounts banner appears.
5. Tap **Restore next account**. The restored account keeps its manifest name
   and hidden flag.
6. Continue until the banner disappears.

## Device

1. Add account. Exactly one biometric/passcode prompt appears.
2. Cancel the prompt. No account is added and state is unchanged.
3. Restore a pending account. Exactly one biometric/passcode prompt appears.
4. Rename, hide, unhide, and set-primary perform metadata-only writes and do
   not prompt.

## Migration

1. Simulate a schema-2 MMKV index and manifest with accounts that lack
   `hidden` and `name`.
2. Launch the app. Entries read as schema 3 with `hidden: false` and no name
   loss.
3. Corrupt one stored address. The app logs a warning containing only wallet id
   and account index, then displays `Invalid address` instead of crashing.

## Cross-Validation

Mnemonic:

`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`

Path base: `m/44'/60'/0'/0`

| Index | App-derived address                          | viem `mnemonicToAccount`                     |
| ----- | -------------------------------------------- | -------------------------------------------- |
| 0     | `0x9858EfFD232B4033E47d90003D41EC34EcaEda94` | `0x9858EfFD232B4033E47d90003D41EC34EcaEda94` |
| 1     | `0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0` | `0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0` |
| 2     | `0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A` | `0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A` |
