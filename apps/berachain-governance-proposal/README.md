# Berachain Governance Proposal Script

This project is a script to create, manage, and execute governance proposals for creating a Rewards Vault on Berachain.

## Setup and Initial Configuration

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the project root with the following content:
   ```
   RPC=https://bartio.rpc.berachain.com/
   PRIVATE_KEY=your_private_key_here
   FACTORY_ADDRESS=0x2B6e40f65D82A0cB98795bC7587a71bfa49fBB2B
   LP_TOKEN_ADDRESS=your_lp_token_address_from_bartio
   GOVERNANCE_ADDRESS=0xE3EDa03401Cf32010a9A9967DaBAEe47ed0E1a0b
   BERACHEF_ADDRESS=0xfb81E39E3970076ab2693fA5C45A07Cc724C93c2
   BGT_ADDRESS=0xbDa130737BDd9618301681329bF2e46A016ff9Ad
   ```

3. Replace `your_private_key_here` with your actual private key.
4. Replace `your_lp_token_address_from_bartio` with your LP token address from Bartio.

## Step-by-Step Guide

### 1. Create Rewards Vault
Run:
```bash
node governance.js --create-vault
```
This will create or retrieve your Rewards Vault.

### 2. Create Governance Proposal
Run:
```bash
node governance.js --create-proposal
```
This creates a new governance proposal to whitelist your Rewards Vault.

After running this command, update your `.env` file with the new `PROPOSAL_ID`:
```
PROPOSAL_ID=your_new_proposal_id
```

### 3. Monitor Proposal Progress
Use this command to check the current state of your proposal:
```bash
node governance.js --check-state
```

The proposal goes through the following stages:
- Pending: 3 hours
- Active (Voting): 3 hours
- Queued: 3 hours
- Ready for Execution

### 4. Vote on the Proposal
Once the proposal is in the Active state, cast your vote:
```bash
node governance.js --vote
```

### 5. Execute the Proposal
After the queuing period, execute the proposal:
```bash
node governance.js --execute
```

## Additional Commands

### Cancel a Proposal
If needed, you can cancel a proposal in the Pending state:
```bash
node governance.js --cancel
```

## Important Notes

- The entire process from proposal creation to execution takes approximately 9 hours.
- Remember to update your `.env` file with the `PROPOSAL_ID` after creating a new proposal.
- Use the `--check-state` command frequently to monitor your proposal's progress.
- Ensure you have sufficient BGT tokens and voting power before creating a proposal(1000 to create a proposal, 2B to get a vote through).

For any issues or questions, please refer to the Governance tutorial or the Berachain team on discord. 