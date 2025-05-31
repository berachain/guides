# Batch Transactions on Berachain

Welcome to the Batch Transactions project! This repository demonstrates how to deploy and interact with a batch transaction system on Berachain, including EIP-7702 self-executing contract writes using [viem](https://viem.sh/).

---

## 🚀 Live Example

- **Batch Transaction Example:** [View on Berascan](https://testnet.berascan.com/tx/0x87bab52cb9f14304e2ec0de0973bb46bcd2c2ddab37818fe4c3bf5c394f3560f)
- **Contracts Deployed:**
  - BatchTransaction: `0xcc97617ae52535e68c535a43f466a03ae1fac8b3`
  - UrsaToken: `0x10e5524bc00869f05ec6e636aba7dcf5881a590a`
  - VestingContract: `0x27180feeb0ce7e497be8af44b3fdb4cfdbdc11cb`

---

## 🗂️ Repository Layout

```
.
├── src/
│   ├── BatchTransaction.sol      # Batch transaction contract
│   ├── UrsaToken.sol            # ERC20 token contract
│   └── VestingContract.sol      # Vesting contract
│
├── test/
│   └── BatchTransaction.t.sol   # Foundry tests for batch logic
│
├── script/
│   ├── deploy-and-execute.js    # Node.js script for deployment & batch execution (EIP-7702)
│   └── artifacts.js             # Compiled contract ABIs/bytecode (auto-generated)
│
├── deployed-addresses.json      # Persisted contract addresses (auto-generated)
├── .env                         # Environment variables (private key, RPC, etc.)
└── README.md                    # This documentation
```

---

## 🧑‍💻 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

Create a `.env` file:

```
PRIVATE_KEY=your_private_key_here
RPC_URL=https://bepolia.rpc.berachain.com
```

### 3. Compile Contracts

```bash
forge build
```

### 4. Generate Artifacts (if needed)

```bash
node script/compile.js
```

### 5. Deploy & Execute Batch

```bash
node script/deploy-and-execute.js
```

- The script will deploy contracts if not already deployed, or use existing ones.
- It will mint tokens, set up EIP-7702 authorization, and execute a batch of approvals and locks in a single transaction.

---

## 🧪 Testing

- All core logic is covered by Foundry tests in `test/BatchTransaction.t.sol`.
- Run tests with:
  ```bash
  forge test -vvv
  ```

---

## 📝 How It Works

- **BatchTransaction.sol**: Allows atomic execution of multiple contract calls (e.g., ERC20 approvals and vesting locks).
- **UrsaToken.sol**: Simple ERC20 token contract for demonstration.
- **VestingContract.sol**: Allows tokens to be locked for a period, with batch support.
- **EIP-7702 Integration**: Uses [viem](https://viem.sh/docs/eip7702/contract-writes) to authorize and execute contract calls from an EOA in a single transaction.

---

## 🧩 Example Batch Transaction

- [View on Berascan](https://testnet.berascan.com/tx/0x87bab52cb9f14304e2ec0de0973bb46bcd2c2ddab37818fe4c3bf5c394f3560f)
- This transaction demonstrates:
  - 3 ERC20 approvals
  - 3 vesting locks
  - All executed atomically via EIP-7702

---

## 🤝 Contributing

PRs and issues are welcome! Please open an issue if you have questions or suggestions.

---

## 📚 References

- [Viem EIP-7702 Contract Writes](https://viem.sh/docs/eip7702/contract-writes)
- [Berachain Testnet Explorer](https://testnet.berascan.com/)

---

_Happy batching on Berachain!_ 🚀
