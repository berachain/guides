# Index ERC-20 Contract Using Envio

> See the full [GitHub Project Code Repository](https://github.com/berachain/guides/tree/main/apps/envio-indexing-erc20)

This developer guide will walk you through setting up an indexer, to query any ERC20 contract on the Berachain network using a GraphQL API, all with **[Envio](https://envio.dev)**.

This guide analyzes all WETH token "approval" and "transfer" event logs emitted by the WETH contract to gain real-time insights into metrics such as token holders, balances, and transfers of the WETH token. For this guide, let's analyze the top ten accounts with the largest WETH holdings, by querying the balance of token holders.

# Requirements

Before beginning, make sure you have the following installed or set up on your computer beforehand.

- **[Envio](https://docs.envio.dev/docs/getting-started)**

# ERC20 Indexer Project Code Setup

Let's start by initializing the indexer and generating a boilerplate to index all events emitted by the WETH ERC20 token contract on Berachain.

This is the WETH contract address: [0x8239FBb3e3D0C2cDFd7888D8aF7701240Ac4DcA4](https://artio.beratrail.io/token/0x8239FBb3e3D0C2cDFd7888D8aF7701240Ac4DcA4).

1. Open your terminal in a preferred directory and run the command `envio init`.

2. Name your indexer anything you’d like (e.g. `weth-berachain-indexer`), and specify a folder name (e.g.`weth-berachain-indexer`.)

3. Choose a preferred language, select `Template`, and then select `Erc20`.

<img src="/docs-assets/envio-index-erc20-1.png" alt="envio-index-erc20-1" width="100%"/>

> Note: Indexers on Envio can be written in JavaScript, TypeScript, or ReScript. For this demonstration, we’ve chosen to use TypeScript as the preferred language.

A project template is generated with all the required files to run your indexer.

Let's take a look at the files generated by Envio in our source-code editor, in this example, we’re using [VS Code](https://code.visualstudio.com/) (Visual Code Studio).

# Overview of Generated Code

1. **config.yaml**

This file defines the network, start block, contract address, and events we want to index on Berachain.

Replace the placeholder values for network, start block and contract address with the correct values, i.e.

- Network Id = 80085
- Start Block = 0
- Contract Address = 0x8239FBb3e3D0C2cDFd7888D8aF7701240Ac4DcA4

2. **Schema.graphql**

This file saves and defines the data structures for selected events, such as the `Approval` event.

3. **event-handler**

This file defines what happens when an event is emitted and saves what code is going to run, allowing customization in data handling.

# Starting the Indexer & Exploring Indexed Data

Now, let's run our indexer locally by running `envio dev` command.

Your browser would have opened a local Hasura console at [http://localhost:8080/console](http://localhost:8080/console). Let’s explore the indexed data.

1. Head over to the Hasura console, type in the admin-secret password `testing`, and navigate to “Data” in the above column to explore the data. For example, you can:

- View "events_sync_state" table to see which block number you are on to monitor the indexing progress.
- View the "chain_metadata" table to see the block height of the chain.
- View the "raw_events" table to see all events being indexed.

If you view the "Account" table, you will see a column called "balance".

<img src="/docs-assets/envio-index-erc20-5.png" alt="envio-index-erc20-5" width="100%"/>

2. Let's analyze this data, by clicking “API” in the above column to access the GraphQL endpoint to query real-time data. From there you can run a query to explore details such as holders and their respective balances of the WETH ERC-20 token.

<img src="/docs-assets/envio-index-erc20-6.png" alt="envio-index-erc20-6" width="100%"/>

# Full Code Repository

The full github code repository can be found in the [guides section](https://github.com/berachain/guides/) of this repository under [Index ERC20 Contract Using Envio](https://github.com/berachain/guides/tree/main/apps/envio-indexer-erc20).
