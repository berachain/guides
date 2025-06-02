---
head:
  - - meta
    - property: og:title
      content: EIP-7702 Gas Sponsorship with Anvil
  - - meta
    - name: description
      content: Set up a quick demo showcasing gas sponsorship on an Anvil fork unlocked by EIP-7702
  - - meta
    - property: og:description
      content: Set up a quick demo showcasing gas sponsorship on an Anvil fork unlocked by EIP-7702
---

# Quickstart: EIP-7702 Gas Sponsorship with Anvil

This quickstart gives you everything you need to simulate gas sponsorship on an Anvil fork using EIP-7702. A comprehensive guide with context on EIP-7702 and gas sponsorship can be found within our [docs](https://docs.berachain.com/developers/). 

There are two parts to this guide:

- **Part A**: Use `cast` to simulate a minimal EIP-7702 sponsorship flow with empty calldata.
- **Part B**: Use a full Solidity script to simulate delegation, signer validation, calldata execution, and sponsor reimbursement.

---

### Part A — Minimal Gas Sponsorship with `cast`

EIP-7702 enables an EOA to act like a smart contract for a single tx. Here we use `cast` to demonstrate a sponsor broadcasting a signed EOA transaction.

#### Run this:

```bash
# 1. Install deps
pnpm install && cp .env.example .env

# 2. Start anvil fork
anvil --hardfork prague --chain-id 80069 --port 8545
```

```bash
# 3. Deploy SimpleDelegate implementation and update .env
source .env && forge script script/Implementation.s.sol:SimpleDelegateScript \
  --rpc-url $TEST_RPC_URL \
  --private-key $EOA_PRIVATE_KEY \
  --broadcast -vvvv \
  | tee deployment.log && \
CONTRACT_ADDRESS=$(grep -Eo '0x[a-fA-F0-9]{40}' deployment.log | tail -n1) && \
sed -i '' "/^CONTRACT_ADDRESS=/d" .env && echo "CONTRACT_ADDRESS=$CONTRACT_ADDRESS" >> .env
```

```bash
# 4. Fetch nonce and compute NONCE_TO_USE
source .env && \
EOA_NONCE=$(cast nonce $EOA_ADDRESS --rpc-url $TEST_RPC_URL) && \
NONCE_TO_USE=$(cast call $CONTRACT_ADDRESS "getNonceToUse(uint256)(uint256)" $EOA_NONCE --rpc-url $TEST_RPC_URL) && \
sed -i '' "/^NONCE_TO_USE=/d" .env && echo "NONCE_TO_USE=$NONCE_TO_USE" >> .env
```

```bash
# 5. Sign EOA tx and broadcast with sponsor (gas paid by sponsor)
source .env && \

EOA_BAL_BEFORE=$(cast balance $EOA_ADDRESS --rpc-url $TEST_RPC_URL) && \
SPONSOR_BAL_BEFORE=$(cast balance $SPONSOR_ADDRESS --rpc-url $TEST_RPC_URL) && \
echo "💰 EOA Balance Before:     $EOA_BAL_BEFORE wei" && \
echo "💸 Sponsor Balance Before: $SPONSOR_BAL_BEFORE wei" && \

AUTH_SIG=$(cast wallet sign-auth $CONTRACT_ADDRESS \
  --private-key $EOA_PRIVATE_KEY \
  --nonce $NONCE_TO_USE \
  --rpc-url $TEST_RPC_URL) && \

CALLDATA=$(cast calldata "execute((bytes,address,uint256),address,uint256)" \
  "(0x,$CONTRACT_ADDRESS,0)" $SPONSOR_ADDRESS $NONCE_TO_USE) && \

TX_HASH=$(cast send $EOA_ADDRESS "$CALLDATA" \
  --private-key $SPONSOR_PRIVATE_KEY \
  --auth "$AUTH_SIG" \
  --rpc-url $TEST_RPC_URL | grep -i 'transactionHash' | awk '{print $2}') && \

cast receipt $TX_HASH --rpc-url $TEST_RPC_URL
```

#### Expected output

- EOA balance unchanged
- Sponsor balance drops by \~`gasUsed * gasPrice`
- `authorizationList` includes the delegate contract
- Status is `1 (success)`

---

### Part B — Full Sponsorship Flow with Solidity Script

This flow includes signer recovery, nonce checks, calldata execution (`burnNative()`), and reverts for replay or cross-chain attempts.

#### ▶️ Prep: kill prior anvil, fork Bepolia

```bash
lsof -i :8545          # find anvil PID
kill -9 <PID>          # kill it
source .env && anvil --fork-url $BEPOLIA_RPC_URL --chain-id 80069 --hardfork prague --port 8545
```

Update your `.env` with real \$tBERA addresses:

```env
EOA_WALLET1_ADDRESS=
EOA_WALLET1_PK=
SPONSOR_WALLET2_ADDRESS=
SPONSOR_WALLET2_PK=
```

#### Run the full flow:

```bash
source .env && forge script script/SimpleDelegatePart2.s.sol:SimpleDelegate2Script \
  --rpc-url $TEST_RPC_URL \
  --broadcast -vvvv
```

#### Expected output

* `burnNative()` successfully called:

  ```bash
  emit Burned(from: EOA, amount: 1e16)
  ```
* Sponsor reimbursed with:

  ```bash
  emit Reimbursed(sponsor: SPONSOR, refund: 2.99e16)
  ```
* Replay attack reverts with `NonceAlreadyUsed()`
* Cross-chain replay reverts with `Invalid signer`

---

That’s it! You’ve run both the minimal and full-stack versions of EIP-7702 sponsorship locally on Bepolia. For more details, see the full walkthrough in the guide within our docs!
