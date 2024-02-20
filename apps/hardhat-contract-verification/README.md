# Bera-HardhatExample

This repo should serve as an example of the config and manual gas-override required for hardhat based contract deployments on Berachain Artio. The repo also should help you verify contracts via hardhat (Routescan api and configs have been provided in the repo).

## Sum-up on the changes made/required for contract deployments on Artio.

1. The default Hardhat `deployContract` is having issue. But crafting the deploy transaction manually with `gasLimit` and `gasPrice` specified works.
2. Removing the gas: “auto” setting in hardhat config file.
3. Building the transaction manually and setting a forced gas limit override (this may be more expensive gas-wise, but not significantly).

## Post fork - please do the following

1. npm init --y
2. npm install --save-dev hardhat
3. npm install --save-dev dotenv
4. create .env - and add WALLET_KEY=0x
5. npx hardhat run scripts/deploy.ts --network berachain-artio

## To deploy on the live testnet

```shell
npx hardhat run scripts/deploy.ts --network berachain-artio
```

---

# To Verify Contracts

### Installation

```shell
npm install --save-dev @nomicfoundation/hardhat-verify
```

### Verify

```shell
npx hardhat verify --network berachain-artio <0x...>
```

Make sure to replace the whole " <0xaddress> ". Correct example would be :-

✅ npx hardhat verify --network berachain-artio 0x3229075dd6F75bD879F7af07d384A0856c30a806
<br>
❌ npx hardhat verify --network berachain-artio <0x3229075dd6F75bD879F7af07d384A0856c30a806> (This is incorrect)

---

# To deploy on a local fork

Spin up a local fork:

```shell
npx hardhat node --fork https://artio.rpc.berachain.com/
```

Run the deploy script in a new terminal:

```shell
npx hardhat run scripts/deploy.ts --network berachain-local
```
