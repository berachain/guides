# Query Berachain Data with Pyth Oracles

[Pyth Network](https://pyth.network/) is a decentralized oracle network that provides high-quality, real-time data for Berachain. This repo provides an example of how to query Pyth Network data on Berachain's Artio Testnet.

Pyth differs from the existing oracle paradigm by using on-demand price updates, where users pull on-chain prices only when needed - learn more [here](https://pyth.network/blog/pyth-a-new-model-to-the-price-oracle).

## Requirements

- Nodejs `v20.11.0` or greater
- pnpm (or another preferred package manager)
- [jq ](https://jqlang.github.io/jq/download/)
- Wallet with testnet $BERA tokens - See the [Berachain Artio Faucet](https://artio.faucet.berachain.com)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) - ensure `foundryup` is run to install binaries

## Quick Setup

### Step 1 - Setup Project & Install Dependencies

```bash
# FROM: ./pyth-oracle

pnpm install;
```

### Step 2 - Set up for Deployment

Run the following to import your wallet's private key into Foundry's keystore (with the `deployer` alias):

```bash
cast wallet import deployer --interactive;
```

Confirm that your wallet was imported by running:

```bash
cast wallet list;

# [Example output]
# deployer (Local)
```

Load the Berachain RPC into your terminal session:

```bash
export BERACHAIN_ARTIO_RPC="https://rpc.ankr.com/berachain_testnet"
```

### Step 3 - Deploying to Berachain

Compile the smart contract:

```bash
# FROM: ./pyth-oracle

forge build;
```

Deploy the smart contract (you will be prompted for the keystore password you set earlier):

```bash
# FROM: ./pyth-oracle

forge create ./src/ConsumerContract.sol:ConsumerContract --rpc-url $BERACHAIN_ARTIO_RPC --account deployer

# [Expected Similar Output]:
# Enter keystore password:
# Deployer: 0x529CA3A690E1bB4e9F04d132bd99D4398f626A44
# Deployed to: 0x9106b2041C896224Af2142ea9C7349aa283Df7C6
# Transaction hash: 0xc8efdd3132080491b42c469fb2219bc6f0432981a46cdd3f6ae73b9e834ff4e4
```

### Step 4 - Interacting with your Contract

Fetch the payload for `priceUpdateData` from the Pyth API & write to file:

```bash
# FROM: ./pyth-oracle

curl -s "https://hermes.pyth.network/v2/updates/price/latest?&ids[]=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" | jq -r ".binary.data[0]" > price_update.txt
```

Call `updatePrice` with the payload:

```bash
# FROM: ./pyth-oracle

cast send <YOUR_DEPLOYED_CONTRACT> --rpc-url $BERACHAIN_ARTIO_RPC "updatePrice(bytes[])"  "[0x`cat price_update.txt`]" --account deployer --value 0.0001ether

# [Expected Similar Output]:
# blockHash               0xf00e38ea8197d088973dc51502b9fb62d089ac31b6fe01002e83a969e9c05f93
# blockNumber             1037572
# contractAddress
# cumulativeGasUsed       208351
# effectiveGasPrice       3000000017
# from                    0x529CA3A690E1bB4e9F04d132bd99D4398f626A44
# ...
```

Next, query the price with `getPrice()`:

```bash
cast call <YOUR_DEPLOYED_CONTRACT> --rpc-url $BERACHAIN_ARTIO_RPC "getPrice()"

# [Expected Similar Output]:
# 0x0000000000000000000000000000000000000000000000000000005c7eedf820000000000000000000000000000000000000000000000000000000000eb29f7bfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff80000000000000000000000000000000000000000000000000000000065f256b1
```

If you encounter errors, see [Troubleshooting](#troubleshooting).

Optionally, decode the hexadecimal output with `abi-decode`:

```bash
cast abi-decode "getPrice()(int64,uint64,int32,uint)"  <YOUR_GETPRICE_OUTPUT>
```

### Troubleshooting

- If you don't act quickly enough, you may encounter the error `0x19abf40e` representing a `StalePrice` error. This means that the `price_update.txt` was too old to be used by the contract. Re-run the sequence of commands in Step 4 to retry.
- The error code `0x025dbdd4` represents an `InsufficientFee` error. Try raising the value of $BERA in the `updatePrice` call e.g. `0.0005ether`.
