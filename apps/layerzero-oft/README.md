# Bridging ERC20 Tokens to Berachain with LayerZero V2

This repository contains an example of how to bridge an existing ERC20 token (in this case, $UNI) from the Sepolia Testnet to the Berachain Testnet using LayerZero V2 and their Omnichain Fungible Token (OFT) standard.

👉 Learn more about [LayerZero V2](https://docs.layerzero.network/contracts/overview)

## Requirements

- Node `v20.11.0` or greater
- pnpm (or another preferred package manager)
- Wallet with Berachain Testnet $BERA tokens - See the [Berachain Artio Faucet](https://artio.faucet.berachain.com)
- Wallet with Sepolia Testnet $UNI tokens - See the [Sepolia Testnet Faucet](https://faucet.quicknode.com/ethereum/sepolia), trade on [Uniswap](https://app.uniswap.org/swap?outputCurrency=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984&inputCurrency=ETH)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) - ensure `foundryup` is run to install binaries

### Step 1 - Setup Project & Install Dependencies

```bash
# FROM: ./layerzero-oft
forge init;

pnpm install;
pnpm add -D @layerzerolabs/lz-evm-oapp-v2 @layerzerolabs/toolbox-foundry @layerzerolabs/lz-evm-protocol-v2 @layerzerolabs/lz-evm-messagelib-v2 @layerzerolabs/lz-definitions @openzeppelin/contracts --ignore-workspace;
```

Replace the contents of `foundry.toml` with the following:

```toml
[profile.default]
src = "src"
out = "out"
libs = [
    'node_modules/@layerzerolabs/toolbox-foundry/lib',
    'node_modules',
]
remappings = [
    'forge-std/=node_modules/@layerzerolabs/toolbox-foundry/lib/forge-std',
    '@layerzerolabs/=node_modules/@layerzerolabs/',
    '@openzeppelin/=node_modules/@openzeppelin/',
]
```

### Step 2 - Deploy Adapter to Sepolia

Create a `/.env` file at the project root and populate it with your private key:

```toml
PRIVATE_KEY=<YOUR_PRIVATE_KEY>
```

Deploy `MyAdapter.sol` to Sepolia:

```bash
# FROM: ./layerzero-oft

forge script script/MyAdapter.s.sol --rpc-url https://rpc.sepolia.org/ --broadcast
```

### Step 3 - Deploy OFT to Berachain

In `./script/MyOFT.s.sol`, update `SEPOLIA_PEER` with the `Contract Address` of your `MyAdapter` deployment from Step 2

Deploy `MyOFT.sol` to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/MyOFT.s.sol --rpc-url https://artio.rpc.berachain.com/ --broadcast
```

### Step 4 - Bridge Tokens from Sepolia to Berachain

In `./script/Bridge.s.sol`:

- update `SEPOLIA_ADAPTER_ADDRESS` with the deployed contract address from Step 2
- update `BERACHAIN_OFT_ADDRESS` with the deployed contract address from Step 3

Finally, run the following to bridge your $UNI tokens to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/Bridge.s.sol --rpc-url https://rpc.sepolia.org/ --broadcast
```
