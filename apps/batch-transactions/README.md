# Batch Transactions on Berachain

Welcome to the Batch Transactions project! This repository demonstrates how to deploy and interact with a batch transaction system on Berachain, including EIP-7702 self-executing contract writes using [viem](https://viem.sh/).

---

## 🚀 Live Example

- **Batch Transaction Example:** [View on Berascan](https://testnet.berascan.com/tx/0x509c52c2283dc0cbf5f6a09d61cd89a4d24476dba9a7715de5a645a5f89c800d)
- **Contracts Deployed:**
  - BatchTransaction: [`0x23ac058ef2dbcaeb0860f8667fda977bcf26e580`](https://testnet.berascan.com/address/0x23ac058ef2dbcaeb0860f8667fda977bcf26e580)
  - UrsaToken: [`0xa127c5495752501f45d8ceb8dffc08fdee8a6b8b`](https://testnet.berascan.com/address/0xa127c5495752501f45d8ceb8dffc08fdee8a6b8b)
  - VestingContract: [`0xbfe1ccec519799519db02b841e55f7c6efeb1eed`](https://testnet.berascan.com/address/0xbfe1ccec519799519db02b841e55f7c6efeb1eed)

---

## 🗂️ Repository Layout

```bash
.
├── src/
│   ├── BatchTransaction.sol     # Batch transaction contract
│   ├── UrsaToken.sol            # ERC20 token contract
│   └── VestingContract.sol      # Vesting contract
│
├── test/
│   └── BatchTransaction.t.sol   # Foundry tests for batch logic
│
├── scripts/
│   ├── deploy-and-execute.js    # Node.js script for deployment & batch execution (EIP-7702)
│   ├── compile.js              # Script to compile contracts and generate artifacts
│   └── artifacts.js            # Compiled contract ABIs/bytecode (auto-generated)
│
├── deployed-addresses.json      # Persisted contract addresses (auto-generated)
├── .env                        # Environment variables (private key, RPC, etc.)
└── README.md                   # This documentation
```

---

## 🧑‍💻 Quick Start

### 1. Install Dependencies

```bash
# FROM: ./apps/batch-transactions
npm install
```

### 2. Set Up Environment

Create `.env` file with the following content:

```bash
# Your private key (replace with your actual private key)
PRIVATE_KEY=your_private_key_here

# Berachain Bepolia RPC URL
RPC_URL=https://bepolia.rpc.berachain.com

# Chain configuration
CHAIN_ID=80085
CHAIN_NAME=Berachain Bepolia
CHAIN_NATIVE_CURRENCY_NAME=BERA
CHAIN_NATIVE_CURRENCY_SYMBOL=BERA
CHAIN_NATIVE_CURRENCY_DECIMALS=18
```

### 3. Compile Contracts

```bash
# FROM: ./apps/batch-transactions
npm run compile
```

### 4. Deploy & Execute Batch

```bash
# FROM: ./apps/batch-transactions
npm run dev
```

Expected output:

```
Using existing deployed contracts:
BatchTransaction: 0x23ac058ef2dbcaeb0860f8667fda977bcf26e580
UrsaToken: 0xa127c5495752501f45d8ceb8dffc08fdee8a6b8b
VestingContract: 0xbfe1ccec519799519db02b841e55f7c6efeb1eed
Tokens already minted to executor
Executing batch transactions with EIP-7702 authorization...
Batch executed successfully
Transaction hash: 0x509c52c2283dc0cbf5f6a09d61cd89a4d24476dba9a7715de5a645a5f89c800d
Number of beneficiaries: 3
Amount per beneficiary: 50000000000000000000000
Lock duration: 31536000
```

---

## 📝 How It Works

### Batch Transaction Contract

- Allows atomic execution of multiple contract calls
- Supports EIP-7702 authorization for self-executing contract writes
- Includes nonce-based replay protection
- Maximum batch size of 100 transactions

### Token and Vesting

- **UrsaToken**: ERC20 token with minting capabilities
- **VestingContract**: Manages token vesting schedules
- Each board member receives 50,000 tokens
- Tokens are locked for 1 year (31,536,000 seconds)

### EIP-7702 Integration

- Uses [viem](https://viem.sh/docs/eip7702/contract-writes) for authorization
- Enables EOA to execute contract calls in a single transaction
- Supports batch operations for gas efficiency

---

## 🧪 Testing

Run the Foundry tests:

```bash
# FROM: ./apps/batch-transactions
forge test -vvv
```

The test suite covers:

- Batch approvals and locks
- Nonce management
- Transaction failure handling
- Batch size limits

---

## 🔄 Reusing Deployed Contracts

The script saves deployed contract addresses in `deployed-addresses.json`. To:

- Use existing contracts: Keep the file
- Deploy new contracts: Delete the file
- Update nonce: Modify the nonce value in `deploy-and-execute.js`

---

## 🤝 Contributing

PRs and issues are welcome! Please open an issue if you have questions or suggestions.

---

## 📚 References

- [Viem EIP-7702 Contract Writes](https://viem.sh/docs/eip7702/contract-writes)
- [Berachain Documentation](https://docs.berachain.com)
- [EIP-7702 Specification](https://eips.ethereum.org/EIPS/eip-7702)

---

_Happy batching on Berachain!_ 🚀
