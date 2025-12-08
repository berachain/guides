# Bridging ERC20 Tokens from Base to Berachain with LayerZero V2

This repository contains an example of how to deploy a custom ERC20 token on Base, create a LayerZero adapter, deploy an OFT on Berachain, and migrate tokens from Base to Berachain using LayerZero V2 and their Omnichain Fungible Token (OFT) standard.

👉 Learn more about [LayerZero V2](https://docs.layerzero.network/v2)

![LayerZero Berachain OFT Bridging](./README/layerzero-flow.png)

## Requirements

- Node `v20.11.0` or greater
- npm
- Wallet with Berachain Mainnet $BERA tokens - See [Berachain Bridge](https://bridge.berachain.com)
- Wallet with Base Mainnet $ETH tokens - See [Base Bridge](https://bridge.base.org/deposit)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) - ensure `foundryup` is run to install binaries

### Step 1 - Setup Project & Install Dependencies

Install project dependencies:

```bash
# FROM: ./layerzero-oft

npm install;
```

### Step 2 - Deploy Custom Token to Base

Create a `.env` file at the root of `./layerzero-oft` with the following and populate it with your values:

```toml
# Required for all operations
PRIVATE_KEY=

# Contract addresses (populated after deployment)
BASE_TOKEN_ADDRESS=
BASE_ADAPTER_ADDRESS=
BERACHAIN_OFT_ADDRESS=

# Optional: Bridge configuration
TO_ADDRESS=          # Recipient address (defaults to signer if not set)
TOKENS_TO_SEND=      # Amount to bridge in wei (defaults to 100 tokens if not set)
```

**Note**: Library addresses and DVN addresses are already configured in `.env.example`. Copy those values to your `.env` file or reference the `.env.example` file for the complete configuration.

Deploy your custom ERC20 token to Base Mainnet:

```bash
# FROM: ./layerzero-oft

forge script script/MyToken.s.sol --rpc-url https://mainnet.base.org --broadcast
```

Update `BASE_TOKEN_ADDRESS` in your `.env` file with the address of your token deployment.

**Example Deployment:**
- **Token Address**: `0xB855AD471a3a865A81F6057ee3868531784447fA`
- **BaseScan**: [View Contract](https://basescan.org/address/0xb855ad471a3a865a81f6057ee3868531784447fa)

### Step 3 - Deploy Adapter to Base

Deploy `MyAdapter.sol` to Base Mainnet:

```bash
# FROM: ./layerzero-oft

forge script script/MyAdapter.s.sol --rpc-url https://mainnet.base.org --broadcast
```

Update `BASE_ADAPTER_ADDRESS` in your `.env` file with the address of your `MyAdapter` deployment.

**Example Deployment:**
- **Adapter Address**: `0x031A382C7C1AfE8587A663355804878efB56ce52`
- **BaseScan**: [View Contract](https://basescan.org/address/0x031A382C7C1AfE8587A663355804878efB56ce52)

### Step 4 - Deploy OFT to Berachain

Deploy `MyOFT.sol` to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/MyOFT.s.sol --rpc-url https://rpc.berachain.com/ --broadcast
```

Update `BERACHAIN_OFT_ADDRESS` in your `.env` file with the address of your `MyOFT` deployment.

**Example Deployment:**
- **OFT Address**: `0x6CB0268387BAEFaace08b2368F21E8983Ec05988`
- **Berachain Explorer**: [View Contract](https://berascan.com/address/0x6cb0268387baefaace08b2368f21e8983ec05988)
- **Verification GUID**: `aglxnljk3fxvqejt18xsgxzqvp4cvdehrpdrmkjk8bgbh7kcpb`

### Step 5 - Wire Messaging Libraries and Configurations

Configure your contracts for cross-chain messaging. This step includes setting up peers and messaging configurations.

**Note**: Library addresses and DVN addresses are pre-configured in `.env.example`. Copy those values to your `.env` file.

#### 5.1 - Set Peer Connections

Configure peer connections so your contracts know where to send messages:

**Set Base Adapter Peer (Base → Berachain):**
```bash
# FROM: ./layerzero-oft

forge script script/SetPeersBase.s.sol --rpc-url https://mainnet.base.org --broadcast
```

**Set Berachain OFT Peer (Berachain → Base):**
```bash
# FROM: ./layerzero-oft

forge script script/SetPeersBerachain.s.sol --rpc-url https://rpc.berachain.com/ --broadcast
```

**Verify Peer Configuration:**

You can verify that peers are set correctly using `cast`:

```bash
# Verify Base Adapter peer (should return Berachain OFT address)
cast call <BASE_ADAPTER_ADDRESS> "peers(uint32)(bytes32)" 30362 --rpc-url https://mainnet.base.org

# Verify Berachain OFT peer (should return Base Adapter address)
cast call <BERACHAIN_OFT_ADDRESS> "peers(uint32)(bytes32)" 30184 --rpc-url https://rpc.berachain.com/
```

#### 5.2 - Configure Send and Receive Settings

Configure the executor and ULN (DVN) settings for both send and receive operations:

**Configure Base Send Settings (Base → Berachain):**
```bash
# FROM: ./layerzero-oft

forge script script/SetBaseSendConfig.s.sol --rpc-url https://mainnet.base.org --broadcast
```

This script configures:
- **Executor Config**: Max message size (100,000 bytes) and executor address
- **ULN Config**: Send confirmations (20 blocks) and required DVNs (LayerZero + Nethermind from Base)

**Configure Base Receive Settings (Base ← Berachain):**
```bash
# FROM: ./layerzero-oft

forge script script/SetBaseReceiveConfig.s.sol --rpc-url https://mainnet.base.org --broadcast
```

This script configures:
- **ULN Config**: Receive confirmations (20 blocks) and required DVNs (LayerZero + Nethermind from Berachain)

**Configure Berachain Send Settings (Berachain → Base):**
```bash
# FROM: ./layerzero-oft

forge script script/SetBerachainSendConfig.s.sol --rpc-url https://rpc.berachain.com/ --broadcast --via-ir
```

This script configures:
- **Executor Config**: Max message size (100,000 bytes) and executor address
- **ULN Config**: Send confirmations (20 blocks), required DVNs (LayerZero + Nethermind from Berachain), and optional BERA DVN

**Configure Berachain Receive Settings (Berachain ← Base):**
```bash
# FROM: ./layerzero-oft

forge script script/SetBerachainReceiveConfig.s.sol --rpc-url https://rpc.berachain.com/ --broadcast --via-ir
```

This script configures:
- **ULN Config**: Receive confirmations (20 blocks), required DVNs (LayerZero + Nethermind from Berachain), and optional BERA DVN

**Note**: The `--via-ir` flag is required for Berachain scripts due to Solidity compiler stack depth limitations.

#### 5.3 - Bera DVN Availability Limitation

**Important**: The optional Bera DVN can only be configured on chains where the Bera DVN is deployed. If the Bera DVN is not available on a destination chain, you cannot use it as an optional DVN in your configuration.

This limitation exists because:
- DVNs must be paid on the source chain for providing verification services
- If a DVN is not deployed on the source chain, it cannot receive payment
- Without payment, the DVN will not deliver verification services

**Bera DVN Supported Chains:**

The Bera DVN is currently deployed on the following chains:

| Chain | DVN Address |
|-------|-------------|
| Arbitrum Mainnet | `0xf2e8...ccb3` |
| Avalanche Mainnet | `0xf18f...0d3d` |
| Berachain Mainnet | `0x1047...0029` |
| BNB Smart Chain (BSC) Mainnet | `0x8ed0...4d76` |
| Ethereum Mainnet | `0xe2e5...2538` |
| Fantom Mainnet | `0x1a53...8b6b` |
| Optimism Mainnet | `0x5f55...6ee0` |
| Polygon Mainnet | `0xcf46...fedd` |

**Note**: Base Mainnet is **not** in the list above, which means the Bera DVN cannot be used as an optional DVN when bridging from Berachain to Base. The configuration scripts in this repository reflect this limitation and do not include the Bera DVN for Base destinations.

### Step 6 - Send Tokens

Now that your contracts are fully configured, you can bridge tokens between chains.

#### 6.1 - Bridge Tokens from Base to Berachain

Run the `Bridge.s.sol` script to bridge your custom tokens from Base to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/Bridge.s.sol --rpc-url https://mainnet.base.org --broadcast
```

**Configuration Options:**

The bridge script supports the following environment variables (all optional with defaults):

- `TO_ADDRESS`: Recipient address on Berachain (defaults to signer address if not set)
- `TOKENS_TO_SEND`: Amount to bridge in wei (defaults to 100 tokens if not set)

**Example Bridge Transactions:**
- **Transaction Hash**: `0x3e67d334cdc456a0d68c6f57166d7b16ec65512daf3904e339e31863878cece7`
- **LayerZero Scan**: [View Transaction](https://layerzeroscan.com/tx/0x3e67d334cdc456a0d68c6f57166d7b16ec65512daf3904e339e31863878cece7)

- **Transaction Hash**: `0x97839ee1064b61d7ac6acf339a9e7e985ed8dee7c809bc5c62a56a40b50bb063`
- **Block Number**: `36269727`
- **Amount Bridged**: `100 MCT` (100 tokens)
- **BaseScan**: [View Transaction](https://basescan.org/tx/0x97839ee1064b61d7ac6acf339a9e7e985ed8dee7c809bc5c62a56a50bb063)

**Bridge Script Features:**

- Automatic token approval
- Fee calculation and validation
- 5% slippage tolerance
- Balance checks before sending
- Detailed transaction logging

