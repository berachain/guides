# Bridging ERC20 Tokens to Berachain with LayerZero V2

This repository contains an example of how to bridge an existing ERC20 token (in this case, $UNI) from the Sepolia Testnet to the Berachain Testnet using LayerZero V2 and their Omnichain Fungible Token (OFT) standard.

👉 Learn more about [LayerZero V2](https://docs.layerzero.network/v2)

![LayerZero Berachain OFT Bridging](./README/layerzero-flow.png)

## Requirements

- Node `v20.11.0` or greater
- pnpm (or another preferred package manager)
- Wallet with Berachain Testnet $BERA tokens - See the [Berachain Artio Faucet](https://artio.faucet.berachain.com)
- Wallet with Sepolia Testnet $UNI tokens - See the [Sepolia Testnet Faucet](https://faucet.quicknode.com/ethereum/sepolia), trade on [Uniswap](https://app.uniswap.org/swap?outputCurrency=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984&inputCurrency=ETH)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) - ensure `foundryup` is run to install binaries

### Step 1 - Setup Project & Install Dependencies

Install project dependencies:

```bash
# FROM: ./layerzero-oft

pnpm install;
```

### Step 2 - Deploy Adapter to Sepolia

Create a `.env` file at the root of `./layerzero-oft` with the following and populate it with your `PRIVATE_KEY`:

```toml
PRIVATE_KEY=
SEPOLIA_ADAPTER_ADDRESS=
BERACHAIN_OFT_ADDRESS=
```

Deploy `MyAdapter.sol` to Sepolia:

```bash
# FROM: ./layerzero-oft

forge script script/MyAdapter.s.sol --rpc-url https://rpc.sepolia.org/ --broadcast
```

Update `SEPOLIA_ADAPTER_ADDRESS` in your `.env` file with the address of your `MyAdapter` deployment.

### Step 3 - Deploy OFT to Berachain

Deploy `MyOFT.sol` to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/MyOFT.s.sol --rpc-url https://artio.rpc.berachain.com/ --broadcast
```

Update `BERACHAIN_OFT_ADDRESS` in your `.env` file with the address of your `MyOFT` deployment.

### Step 4 - Bridge Tokens from Sepolia to Berachain

Finally, run the `Bridge.s.sol` script to bridge your $UNI tokens to Berachain:

```bash
# FROM: ./layerzero-oft

forge script script/Bridge.s.sol --rpc-url https://rpc.sepolia.org/ --broadcast
```
