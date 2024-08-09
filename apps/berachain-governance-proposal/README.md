# Berachain Governance Proposal Script

This project is a script to create, manage, and execute governance proposals for creating a Rewards Vault on Berachain. It is based on the tutorial "Creating a Governance Proposal for Berachain Reward Vaults".

## Installation

To set up the project, follow these steps:

1. Clone the repository and navigate to the project directory.
2. Install the required dependencies:

```bash
npm install
```

## Configuration

Create a `.env` file in the project root and add the following environment variables:

```plaintext
RPC=https://bartio.rpc.berachain.com/
PRIVATE_KEY=your_private_key_here
FACTORY_ADDRESS=0x2B6e40f65D82A0cB98795bC7587a71bfa49fBB2B
LP_TOKEN_ADDRESS=insert__token_address_here
GOVERNANCE_ADDRESS=0xE3EDa03401Cf32010a9A9967DaBAEe47ed0E1a0b
BERACHEF_ADDRESS=0xfb81E39E3970076ab2693fA5C45A07Cc724C93c2
BGT_ADDRESS=0xbDa130737BDd9618301681329bF2e46A016ff9Ad
```

## Commands

The script supports several commands to interact with the governance process. Run the script with the appropriate flag to perform the desired action.

### Create a Rewards Vault

Creates a new rewards vault or retrieves an existing one.

```bash
node governance.js --create-vault
```

### Create a Governance Proposal

Creates a new governance proposal to whitelist the rewards vault.

```bash
node governance.js --create-proposal
```

### Vote on a Proposal

Casts a vote on the specified proposal.

```bash
node governance.js --vote
```

### Execute a Proposal

Executes a queued proposal.

```bash
node governance.js --execute
```

### Cancel a Proposal

Cancels a proposal that is in a cancellable state.

```bash
node governance.js --cancel
```

### Check Proposal State

Checks the current state of the specified proposal.

```bash
node governance.js --check-state
```
