# Irys.xyz NodeJS Upload Script With Berachain $BERA Tokens

An example uploading images to a decentralized storage network using Berachain `$BERA` tokens to pay for the transactions.

> **NOTE:** This example is using mainnet $BERA tokens.

## Requirements

- NMV or Node `v20.11.0` or greater
- Wallet with mainnet $BERA tokens

## Quick Setup

### Step 1 - Install Dependencies

```bash
# FROM: ./irys-bera-nodejs

pnpm install;
```

### Step 2 - Set Environment Variables

```bash
# FROM: ./irys-bera-nodejs

cp .env.example .env;
```

Remember to change your private key.

**File:** `./.env`

```bash
# Wallet Configuration
WALLET_PRIVATE_KEY="<YOUR_WALLET_PRIVATE_KEY>"
```

### Step 3 - Run Script

```bash
# FROM: ./irys-bera-nodejs

pnpm dev;

# [Expected Output]:
# main()
#   { fileSize: 359635 }
#   { cost: '0.000156123661127842 $BERA' }
#   { costWithBuffer: '0.010156123661127843 $BERA' }
#   { balance: '0.010156191810502846 $BERA' }
#   Uploaded file to Irys
#   {
#     receipt: {
#       id: 'Ehi7TfzpxHJCi5eMa4xGhSgnzybg8jQ8wL6iyq8H9Wke',
#       timestamp: 1739997922226,
#       version: '1.0.0',
#       public: 'mJ9InRYCcuqNFk2A51B-...',
#       signature: 'C2G7P8vBab_fPy_...',
#       deadlineHeight: 1617373,
#       block: 1617373,
#       validatorSignatures: [],
#       verify: [Function: bound verifyReceipt] AsyncFunction
#     }
#   }
#   https://gateway.irys.xyz/Ehi7TfzpxHJCi5eMa4xGhSgnzybg8jQ8wL6iyq8H9Wke
# Script complete.
```



