# Smart Operator Manager

The `smart-operator-manager.py` script provides an interactive command-line interface for managing your SmartOperator contract. It simplifies common validator operations like BGT boosting, reward allocation, commission management, and fee claims.

## Installation

Install Python dependencies:

```bash
pip install -r requirements.txt
```

Or install manually:

```bash
pip install web3 eth-account rich questionary
```

## Configuration

The script automatically detects your network and validator configuration by reading `env.sh` in the parent `install-helpers` directory. Ensure your `env.sh` is configured with `BEACOND_HOME` (path to your beacond home directory) and optionally `PRIVATE_KEY` for signing transactions (defaults to Ledger if not set).

## Usage

Run the script:

```bash
./smart-operator-manager.py
```

Or to preview transactions without executing (show calldata only):

```bash
./smart-operator-manager.py --show-calldata
```

The script will:
1. Connect to your configured network (mainnet or Bepolia)
2. Detect your validator pubkey from beacond
3. Look up your SmartOperator contract address from the factory
4. Display your current status and available operations

## Available Operations

The script provides a menu-driven interface with operations organized by category. Available options depend on your role permissions.

### Status and Monitoring

**View Status** displays pool status including contract addresses (SmartOperator, StakingPool, StakingRewardsVault, IncentiveCollector), pool state (active, exited, threshold reached), BGT balances (boosted, unboosted, rebaseable), protocol fee settings, current roles and permissions, reward allocation information, and vault information with names.

### BGT Operations

**Queue Boost** queues unboosted BGT for boosting to your validator. Anyone can call this. **Activate Boost** activates a queued boost and is also callable by anyone. **Queue Drop Boost** queues a request to unboost BGT and requires `BGT_MANAGER_ROLE`. **Execute Drop Boost** executes a queued drop boost and anyone can call it. **Redeem BGT for BERA** converts BGT to BERA and sends it to the staking rewards vault, requiring `BGT_MANAGER_ROLE`.

### Reward Management

**Claim BGT Staker Rewards (HONEY)** claims accumulated HONEY rewards from BGT staking and forwards them to IncentiveCollector. Anyone can call this. For reward claiming that handles both HONEY and incentive tokens, use `claimBoostRewards()` directly via cast or other tools. The script provides `claimBgtStakerReward()` for HONEY-only claims.

### Rewards Allocation

**Queue Rewards Allocation** queues new reward allocation weights for directing PoL incentives to specific applications. This requires `REWARDS_ALLOCATION_MANAGER_ROLE`. You specify the start block when the allocation becomes active, enter receiver addresses and percentage weights, and ensure the total equals 100%.

### Commission Management

**Register as Validator Operator** registers your address as the validator operator on BeraChef and requires `COMMISSION_MANAGER_ROLE`. **Queue Validator Commission** queues a commission rate change (0-20%) and also requires `COMMISSION_MANAGER_ROLE`. Enter commission in basis points (e.g., 500 = 5%). Changes are queued and take effect after the queue delay.

### Protocol Fee Management

**Set Protocol Fee Percentage** sets the protocol fee percentage (0-20%) charged on BGT balance growth and requires `PROTOCOL_FEE_MANAGER_ROLE`. **Accrue Earned BGT Fees** manually triggers fee calculation and minting and also requires `PROTOCOL_FEE_MANAGER_ROLE`.

### Role Management

**Manage Roles** grants or revokes operational roles to addresses and requires appropriate permissions. You can view current role assignments, select roles to grant or revoke, and batch apply changes.

## Transaction Execution

By default, the script builds and executes transactions using your configured signing method (Ledger or private key). Each operation builds the transaction with current gas estimates, shows a summary of what will happen, prompts for confirmation before sending, and displays the transaction hash and status.

Use `--show-calldata` flag to preview transactions without executing them. This is useful for reviewing transaction details, executing transactions manually with cast, or debugging transaction construction.

## Error Handling

The script includes error handling and validation. Preflight checks simulate transactions before execution to catch errors early. Role verification checks your permissions before showing operations. Input validation validates addresses, amounts, and percentages. Network detection automatically detects mainnet vs Bepolia. Revert decoding attempts to decode and display meaningful error messages.

## Examples

**Check pool status:**
```bash
./smart-operator-manager.py
# Select "📊 View Status"
```

**Queue a boost:**
```bash
./smart-operator-manager.py
# Select "⬆️  Queue Boost (unboosted → boosted)"
```

**Set protocol fee:**
```bash
./smart-operator-manager.py
# Select "💸 Set Protocol Fee Percentage"
# Enter fee percentage (e.g., 5 for 5%)
```

**Manage roles:**
```bash
./smart-operator-manager.py
# Select "🔑 Manage Roles"
# Enter address to manage
# Select roles to grant/revoke
```

## Tips

Run with `--show-calldata` first to review transactions before executing. Use the status view regularly to monitor pool health. Check role permissions if an operation isn't available in the menu. The script automatically detects your network and validator from beacond configuration. All operations require appropriate role permissions as enforced by the SmartOperator contract.

