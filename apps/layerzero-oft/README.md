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

Create a `.env` file at the root of `./layerzero-oft` with the following and populate it with your `PRIVATE_KEY`:

```toml
PRIVATE_KEY=
BASE_TOKEN_ADDRESS=
BASE_ADAPTER_ADDRESS=
BERACHAIN_OFT_ADDRESS=
```

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

### Step 4.5 - Discover Library Addresses

Before configuring libraries, you need to discover the default library addresses for each chain. Run the library discovery scripts:

**Discover Base Libraries:**
```bash
# FROM: ./layerzero-oft

forge script script/GetBaseLibraries.s.sol --rpc-url https://mainnet.base.org
```

**Discover Berachain Libraries:**
```bash
# FROM: ./layerzero-oft

forge script script/GetBerachainLibraries.s.sol --rpc-url https://rpc.berachain.com/
```

Copy the output values into your `.env` file. The discovered library addresses are:

#### Library Addresses

| Chain | Library Type | Address | Usage |
|-------|-------------|---------|-------|
| **Base** | Send Library | `0xB5320B0B3a13cC860893E2Bd79FCd7e13484Dda2` | Used by Base adapter to send messages |
| **Base** | Receive Library | `0xc70AB6f32772f59fBfc23889Caf4Ba3376C84bAf` | Used by Base adapter to receive messages |
| **Berachain** | Send Library | `0xC39161c743D0307EB9BCc9FEF03eeb9Dc4802de7` | Used by Berachain OFT to send messages |
| **Berachain** | Receive Library | `0xe1844c5D63a9543023008D332Bd3d2e6f1FE1043` | Used by Berachain OFT to receive messages |

**Note**: These are the default libraries discovered from the LayerZero endpoints. Always verify current library addresses by running the discovery scripts, as they may change.

### Step 5 - Configure Libraries

After discovering the library addresses, configure them for your contracts:

**Configure Base Adapter Libraries:**
```bash
# FROM: ./layerzero-oft

forge script script/SetBaseLibraries.s.sol --rpc-url https://mainnet.base.org --broadcast
```

**Configure Berachain OFT Libraries:**
```bash
# FROM: ./layerzero-oft

forge script script/SetBerachainLibraries.s.sol --rpc-url https://rpc.berachain.com/ --broadcast
```

### Step 6 - Bridge Tokens from Base to Berachain

Finally, run the `Bridge.s.sol` script to bridge your custom tokens from Base to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/Bridge.s.sol --rpc-url https://mainnet.base.org --broadcast
```

**Example Bridge Transaction:**
- **Transaction Hash**: `0x97839ee1064b61d7ac6acf339a9e7e985ed8dee7c809bc5c62a56a40b50bb063`
- **Block Number**: `36269727`
- **Amount Bridged**: `100 MCT` (100 tokens)
- **BaseScan**: [View Transaction](https://basescan.org/tx/0x97839ee1064b61d7ac6acf339a9e7e985ed8dee7c809bc5c62a56a40b50bb063)

## Step 7 - Configure DVN Settings (IMPORTANT: Prevents DVN Mismatch Errors)

**Critical**: You must configure DVNs for receive operations on both chains to prevent "DVN mismatch" errors. This is often missed but essential for proper cross-chain functionality.

### DVN Addresses

These are the verified DVN addresses for Base and Berachain. **Important**: DVN addresses are chain-specific and depend on the direction of message flow.

#### DVN Addresses Table

| Chain | DVN Type | Address | Usage | Required |
|-------|----------|---------|-------|----------|
| **Base** | LayerZero DVN | `0x9e059a54699a285714207b43b055483e78faac25` | Verifies messages sent FROM Base | ✅ Required |
| **Base** | Nethermind DVN | `0xcd37ca043f8479064e10635020c65ffc005d36f6` | Verifies messages sent FROM Base | ✅ Required |
| **Berachain** | LayerZero DVN | `0x282b3386571f7f794450d5789911a9804fa346b4` | Verifies messages sent FROM Berachain | ✅ Required |
| **Berachain** | Nethermind DVN | `0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b` | Verifies messages sent FROM Berachain | ✅ Required |
| **Berachain** | BERA DVN | `0x10473bd2f7320476b5e5e59649e3dc129d9d0029` | Additional verification for Berachain | ⚪ Optional |

**Configuration Notes:**
- **Base → Berachain**: Configure Berachain OFT with **Base DVNs** (LayerZero + Nethermind from Base)
- **Berachain → Base**: Configure Base Adapter with **Berachain DVNs** (LayerZero + Nethermind from Berachain)
- The BERA DVN is optional and can be added for additional verification on Berachain

**Source**: These addresses are from [LayerZero DVN Providers](https://docs.layerzero.network/v2/deployments/dvn-addresses). Always verify current addresses as they may change.

### Configure DVNs After Library Setup

1. **Configure Base Adapter (for receiving from Berachain)**:

```bash
# FROM: ./layerzero-oft

forge script script/ConfigureBaseDVNs.s.sol --rpc-url https://mainnet.base.org --broadcast
```

2. **Configure Berachain OFT (for receiving from Base)**:

```bash
# FROM: ./layerzero-oft

forge script script/ConfigureBerachainDVNs.s.sol --rpc-url https://rpc.berachain.com/ --broadcast
```

### Alternative: Complete Configuration Script

If you prefer to configure both chains at once:

```bash
# FROM: ./layerzero-oft

# This script configures both Base and Berachain DVNs
forge script script/ConfigureDVNs.s.sol --rpc-url https://mainnet.base.org --broadcast
```

### Troubleshooting DVN Mismatch

If you encounter a "DVN mismatch" error when bridging, it means:

1. **Receive DVNs are not configured** - The receiving contract doesn't know which DVNs to trust
2. **Incorrect DVN addresses** - The DVNs you configured don't match the actual DVN addresses for the chains
3. **Missing DVNs in receive config** - You may have configured send DVNs but not receive DVNs

### DVN Configuration Explained

The scripts configure **receive ULN configs** which tell your contracts:
- Which DVNs are required to verify incoming messages
- Which DVNs are optional 
- How many confirmations are needed

This is different from send configurations and must be done for **both directions** of the bridge:

- **Base → Berachain**: Configure BERACHAIN OFT receive DVNs
- **Berachain → Base**: Configure BASE ADAPTER receive DVNs

**Note**: Always verify current DVN addresses at the [LayerZero DVN Providers](https://docs.layerzero.network/v2/deployments/dvn-addresses) as they may change.
