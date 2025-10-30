# Bash Helper Scripts

Automation scripts for deploying and managing Berachain staking pools. These scripts handle interactions with both the beacon chain (`beacond`) and the execution layer, wrapping multi-step processes into simple command-line tools.

## Contents (brief)

- activate.sh: Deploy and activate a staking pool; generates deployment/activation command scripts.
- status.sh: Verify core contracts, operator registration, pool status, telemetry, and BGT disposition.
- stake.sh / stake-command.sh: Generate stake transaction for BERA → stBERA.
- unstake.sh / unstake-command.sh: Basic pool-active check and withdrawal request helper.
- generate-frontend-config.sh: Emit frontend/config.json from env + factory lookups.
- smart-operator-manager.py: Interactive operator CLI (status, vault names, roles, boost, rewards allocation, commission queue). Uses PRIVATE_KEY.
- Delegation helpers:
  - delegator-deploy-handler.sh: Deploy DelegationHandler for a validator pubkey.
  - delegator-delegate.sh: Fund + delegate to handler and grant operator role.
  - delegated-create-pool.sh: Create staking pool using delegated funds (10,000 BERA).
  - delegated-deposit.sh: Deposit remaining delegated funds.
  - delegated-withdraw-yield.sh: Request/complete yield withdrawals.
  - delegator-withdraw-principal.sh: Request/complete principal withdrawal and undelegate.
- lib-common.sh: Shared functions (logging, env loading, cast wrappers, network constants).
- env.sh.template / env.sh: Local configuration (BEACOND_HOME, PRIVATE_KEY, etc.).
- requirements.txt: Python dependencies for smart-operator-manager.

## SmartOperator Manager (Python)

A standalone, interactive CLI for validator operators.

Setup

- Python 3.10+
- Install deps once:
  - `python3 -m venv ~/venv && source ~/venv/bin/activate`
  - `pip install -r requirements.txt`
- Env vars:
  - `BEACOND_HOME` (path to CL home; used to detect network and pubkey)
  - `PRIVATE_KEY` (0x-prefixed; used for transactions)
  - Optional: `SOM_TX_LOG` (set to `1`/`true` or a file path to enable calldata logging)

Run

```bash
env PRIVATE_KEY=0x... BEACOND_HOME=/path/to/cl python3 smart-operator-manager.py
```

What it shows / does

- Status dashboard: core contracts (from factory), BGT balances, protocol fee, reward allocator, active reward allocation with vault names (API + known names), queued allocation preview, staking pool state.
- Roles: interactive editor to toggle roles (commits or cancels changes).
- Boost: queue/activate/drop flows and redeem BGT for BERA.
- Rewards allocation: queue new allocations with start block and weights.
- Commission: preflight and queue validator commission via SmartOperator.
- Operator registration: one-click “Register as Validator Operator” (sets SmartOperator as its own reward allocator on BeraChef).

Notes

- All actions are executed through the SmartOperator.
- Vault names are resolved via Berachain API on the detected network; known individual vault names are used as fallback.
- Calldata logging is off by default; enable via `SOM_TX_LOG` if you need a tx log for simulation.

## Requirements

All scripts require the following tools installed and available in your PATH:

- **beacond**: Berachain validator client binary
- **cast**: From Foundry toolkit (https://book.getfoundry.sh/)
- **jq**: JSON processor
- **bc**: Basic calculator for arbitrary precision arithmetic
- **curl**: HTTP client

For deployment and transaction signing, you need either:
- A Ledger hardware wallet, OR
- A private key (configured in `env.sh`)

Validators need sufficient BERA balance (10,000+ BERA for initial deposit, 250,000 BERA minimum on Bepolia).

## Quick Start

**Important:** All scripts generate `cast` commands in temporary shell scripts for you to review and execute. Running these scripts is safe - they won't execute transactions without your approval.

### Self-Funded Validators

1. Copy `env.sh.template` to `env.sh` and set `BEACOND_HOME`
2. Check status anytime: `./status.sh`
2. Deploy: `./activate.sh --sr 0x... --op 0x...`
2. Activate: `./activate.sh --sr 0x... --op 0x...` (yes, again)
4. Stake BERA: `./stake.sh --amount 100 --receiver 0x... --staking-pool 0x...`

### Capital Providers (Delegators)

**Requires:** BEACOND_HOME configured in `env.sh` (to auto-detect validator pubkey)

1. Deploy handler: `./delegator-deploy-handler.sh --pubkey 0x...`
2. Delegate funds: `./delegator-delegate.sh --amount 250000 --validator-admin 0x...`  
3. Monitor delegation status

### Operators Using Delegated Funds  

**Requires:** BEACOND_HOME configured in `env.sh` (to auto-detect validator pubkey and handler)

1. Create pool: `./delegated-create-pool.sh`
2. Activate: `./activate.sh --sr 0x... --op 0x...`
3. Deposit remaining: `./delegated-deposit.sh --amount 240000`
4. After some time, withdraw yield: `./delegated-withdraw-yield.sh`

## Configuration

Copy `env.sh.template` to `env.sh` for persistent configuration:

```bash
cp env.sh.template env.sh
# Edit env.sh to set:
BEACOND_HOME="/path/to/beacond/home"  # Required
PRIVATE_KEY="0x..."                   # Optional - defaults to Ledger
NODE_API_ADDRESS="127.0.0.1:3500"     # Optional - auto-detected from app.toml
```

All scripts support command-line overrides. Use `--help` on any script for details.

## For Self-Funded Validators

### activate.sh

Deploys and activates your staking pool. The script intelligently detects whether your validator is already registered on the beacon chain:

**For new validators:**
- Auto-detects withdrawal vault from the factory contract
- Validates shares recipient and operator addresses
- Generates validator deposit credentials using `beacond`
- Predicts and displays pool addresses
- Outputs deployment command with initial 10,000 BERA deposit

**After pool is deployed:**
- Fetches validator index from beacon node API
- Retrieves Merkle proofs for pubkey, withdrawal credentials, and balance
- Polls until all proofs reference the same slot
- Generates activation command (must execute within 10 minutes)

**Usage:**
```bash
./activate.sh --sr 0x... --op 0x...
```

**Output files:**
- `deployment-command.sh` (new validators)
- `activation-command.sh` (existing validators)

### status.sh

Verifies your staking pool deployment and checks activation status through three validation steps:

1. **Contract deployment**: Queries factory for core contract addresses and verifies bytecode deployment
2. **Validator registration**: Confirms SmartOperator is registered as operator for your validator pubkey
3. **Pool status**: Checks if pool is active and displays total assets/supply

**Usage:**
```bash
./status.sh
```

### stake.sh

Generates commands to stake BERA to your pool and receive stBERA tokens.

**Usage:**
```bash
# Auto-detect pool from validator config
./stake.sh --amount 100 --receiver 0x...

# Use known pool address
./stake.sh --amount 100 --receiver 0x... --staking-pool 0x...
```

**Output files:**
- `stake-command.sh`: Ready-to-run staking transaction

## For Capital Providers (Delegators)

The delegation system separates capital provision from validator operations. Delegators provide BERA capital and retain control over principal, while operators run validators and earn yield.

### delegator-deploy-handler.sh

Deploys a DelegationHandler contract for a specific validator pubkey. This is the first step before delegating capital.

**Usage:**
```bash
./delegator-deploy-handler.sh --pubkey 0x...
```

**Output files:**
- `delegator-deploy-handler-command.sh`: Deployment transaction

The script checks if a handler already exists and skips deployment if found.

### delegator-delegate.sh

Sends BERA to the handler, marks it as delegated, and grants `VALIDATOR_ADMIN_ROLE` to the operator. This is a three-step process:

1. Send BERA to handler
2. Mark funds as delegated
3. Grant admin role to operator

**Usage:**
```bash
./delegator-delegate.sh --pubkey 0x... --amount 250000 --validator-admin 0x...
```

**Output files:**
- `delegator-delegate-1-send-funds.sh`
- `delegator-delegate-2-delegate.sh`
- `delegator-delegate-3-grant-role.sh`

The handler address is auto-detected from the pubkey using `DelegationHandlerFactory`.

### delegator-withdraw-principal.sh

Withdraws the original delegated principal after validator exit. This is a four-step process with a 3-day cooldown:

1. Request withdrawal
2. Complete withdrawal after cooldown (~3 days)
3. Undelegate funds
4. Withdraw BERA to your address

**Usage:**
```bash
./delegator-withdraw-principal.sh --pubkey 0x...
```

**Output files:**
- `delegator-withdraw-principal-1-request.sh`
- `delegator-withdraw-principal-2-complete.sh`
- `delegator-withdraw-principal-3-undelegate.sh`
- `delegator-withdraw-principal-4-withdraw.sh`

## For Operators Using Delegated Funds

### delegated-create-pool.sh

Creates a staking pool using delegated funds. This deposits the first 10,000 BERA from the delegation handler to register the validator.

**Usage:**
```bash
./delegated-create-pool.sh
```

**Output files:**
- `delegated-create-pool-command.sh`

Auto-detects validator pubkey and delegation handler address. After creation, use `delegated-deposit.sh` to deposit remaining funds.

### delegated-deposit.sh

Deposits additional delegated funds to reach the required stake (e.g., 250,000 BERA on Bepolia).

**Usage:**
```bash
./delegated-deposit.sh --pubkey 0x... --amount 240000
```

**Output files:**
- `delegated-deposit-command.sh`

### delegated-withdraw-yield.sh

Withdraws earned staking rewards (yield only, not principal). Yield can be withdrawn at any time by operators and is independent of principal withdrawals.

This is a two-step process with a 3-day cooldown:

1. Request yield withdrawal
2. Complete withdrawal after cooldown

**Usage:**
```bash
./delegated-withdraw-yield.sh --pubkey 0x...
```

**Output files:**
- `delegated-withdraw-yield-1-request.sh`
- `delegated-withdraw-yield-2-complete.sh`

## Delegation Features

The delegation system provides clear separation of concerns:

- **Automatic handler lookup**: Scripts auto-detect handler addresses from validator pubkeys
- **Role-based access**: Delegators control principal via `DEFAULT_ADMIN_ROLE`, operators control yield via `VALIDATOR_ADMIN_ROLE`
- **Independent withdrawals**: Principal and yield withdrawals don't interfere with each other
- **Pubkey-based identification**: Use `--pubkey` instead of manually tracking handler addresses

## Typical Workflows

### Self-Funded Validator Setup

1. Ensure beacond is running with validator keys and node API enabled in `app.toml`
2. Copy `env.sh.template` to `env.sh` and set `BEACOND_HOME`
3. Run `activate.sh` to generate deployment command
4. Execute `deployment-command.sh` to deploy contracts (10,000 BERA initial deposit)
5. Wait for validator registration on beacon chain (~few epochs, 192 blocks each)
6. Run `activate.sh` again to generate activation command (execute within 10 minutes)
7. Run `status.sh` to verify deployment and activation
8. Use `stake.sh` to add more stake if needed (250,000 BERA minimum on Bepolia)

### Delegated Validator Setup

**Delegator side:**
1. Deploy handler: `./delegator-deploy-handler.sh --pubkey 0x...`
2. Delegate capital: `./delegator-delegate.sh --pubkey 0x... --amount 250000 --validator-admin 0x...`

**Operator side:**
3. Create pool: `./delegated-create-pool.sh` (uses 10,000 BERA)
4. Deposit remaining: `./delegated-deposit.sh --amount 240000`
5. Wait for beacon chain registration
6. Activate: `./activate.sh --sr 0x... --op 0x...`
7. Verify: `./status.sh`

