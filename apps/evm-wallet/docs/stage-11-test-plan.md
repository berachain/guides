# Stage 11 Manual Test Plan: Send Signed Transactions

## Setup

- Use a test wallet funded with a small native-currency balance on a testnet such as Sepolia or Holesky.
- Configure that testnet in Settings with its RPC URL, chain ID, native currency symbol, and block explorer URL.
- Use a known destination EVM address that you can verify on the block explorer.

## Send Flow

- Tap a visible account's Send button and confirm the send screen opens with the correct source account, balance, active network, and currency symbol.
- Paste an invalid hex address and confirm the inline error says it is not a valid EVM address.
- Paste a lowercase address and confirm it is accepted.
- Paste a properly checksummed address and confirm the green valid message is shown.
- Paste a mixed-case address with a bad checksum and confirm the amber checksum warning is shown.
- Enter `0`, an invalid decimal, and an amount larger than the spendable balance; confirm Review is disabled and the correct validation appears.
- Tap Max after balance and fee estimates load; confirm it fills `balance - estimated fee`.
- Tap Slow, Normal, and Fast gas presets; confirm the network fee and total update.
- Configure an RPC that fails `estimateGas`, retry the estimate, and confirm the error stays understandable.
- Tap Review and confirm the review screen shows source account, full destination address, amount, fee preset, network, and total.
- Tap Edit and confirm the send screen returns with the recipient, amount, and gas preset preserved.
- Tap Confirm and send on a physical device and confirm the biometric/passcode prompt appears.
- Cancel authentication and confirm the review screen remains visible with no error banner and no transaction sent.
- Confirm again and complete authentication; confirm the result screen shows a transaction hash.

## Result Flow

- Tap Copy on the result screen and confirm the clipboard contains the full transaction hash.
- Tap View on block explorer and confirm the browser opens to `<explorer>/tx/<hash>`.
- Repeat with a network that has no block explorer URL and confirm the explorer button is hidden and the explanatory note appears.
- Tap Done and confirm the app returns to the wallet detail screen without a send/review/result back stack.
- Pull to refresh or refocus the wallet detail screen and confirm the balance eventually reflects the transaction.

## Cross-Validation

- Verify the transaction hash exists on the testnet block explorer.
- Confirm the explorer's `from`, `to`, value, and chain match the submitted transaction.
- Confirm the destination balance increased by exactly the sent amount.
- Confirm the source balance decreased by the sent amount plus the actual network fee.

## Environment Matrix

Run the full happy path and cancel path in each environment.

### A. Simulator, Local Wallet

- Open the send screen, enter a recipient and amount, review, then tap Confirm.
- Expected: no biometric prompt; the transaction signs and broadcasts immediately.
- Verify the simulator banner is visible on send, review, and result screens.
- Tap the simulator banner and confirm the explanatory alert appears.
- Verify the transaction appears on the testnet explorer.

### B. Simulator, iCloud-Backed Wallet

- Repeat the same flow with a wallet created with iCloud opt-in.
- Expected: no biometric prompt; behavior is identical to the simulator local-wallet path.
- The iCloud-backed nature is invisible on simulator beyond the wallet metadata flag.
- Verify the simulator banner is visible throughout and the transaction appears on the explorer.

### C. Physical Device, Local Wallet (SE Path)

- Repeat the same flow on a real iPhone with a local-only wallet.
- Expected: biometric/passcode prompt fires when Confirm is tapped.
- Auth succeeds: transaction signs and broadcasts.
- Auth canceled: app returns to the review screen, shows no error banner, and broadcasts nothing.
- Verify the successful transaction appears on the explorer.

### D. Physical Device, iCloud-Backed Wallet

- Repeat the same flow on a real iPhone with a wallet created with iCloud opt-in.
- Expected: no biometric prompt. This is intentional because iCloud-backed wallets use the plaintext synced storage path, not the Secure Enclave path.
- Transaction signs and broadcasts directly.
- Document in the test output: "iCloud-backed wallets do not require biometric authentication for signing because their storage path does not use the Secure Enclave."
- Verify the transaction appears on the explorer.

### Cross-Validation Across Environments

- Send a small testnet transaction from A, B, C, and D to the same destination address.
- Verify all four transactions appear on the explorer with the correct `from`, `to`, and value.
- Verify the destination balance increased by 4x the per-transaction amount.

## Edge Cases

- Start a send, navigate back, change the active network, then return to review from the preserved draft; confirm the review screen shows the network-changed warning and disables confirmation until starting over.
- Try sending from an account with a zero balance and confirm the send affordance is disabled.
- Confirm hidden accounts do not show a Send button.
- Confirm no transaction confirmation polling occurs after broadcast.
