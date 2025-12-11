#!/usr/bin/env python3
"""
SmartOperator Manager - Interactive tool for managing validator operations

This script provides an interactive interface for pool operators to manage their
SmartOperator contract, including BGT boosting, reward allocation, and claims.
"""

import sys
import os
import json
import time
import subprocess
import getpass
import re
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from decimal import Decimal

try:
    from web3 import Web3
    from web3.contract import Contract
    from eth_account import Account
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm, IntPrompt
    from rich import box
    import questionary
except ImportError:
    print("Error: Required dependencies not installed.")
    print("Please install them with:")
    print("  pip install web3 eth-account rich questionary")
    sys.exit(1)

console = Console()

# Berachain validator root hashes for network detection
MAINNET_VALIDATOR_ROOT = "0xdf609e3b062842c6425ff716aec2d2092c46455d9b2e1a2c9e32c6ba63ff0bda"
BEPOLIA_VALIDATOR_ROOT = "0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e"

# Berachain contract addresses (mainnet/bepolia) - will be checksummed when used
FACTORY_ADDRESSES = {
    "mainnet": "0xa4Fd7E7771e5a752e6e05d4905843519E1df0885",
    "bepolia": "0x176c081E95C82CA68DEa20CA419C7506Aa063C24"
}

BGT_ADDRESS = "0x656b95E550C07a9ffe548bd4085c72418Ceb1dba"
BERA_CHEF_ADDRESS = "0xdf960E8F3F19C481dDE769edEDD439ea1a63426a"
BGT_STAKER_ADDRESS = "0x44F07Ce5AfeCbCC406e6beFD40cc2998eEb8c7C6"

# Role constants
ROLES = {
    "DEFAULT_ADMIN_ROLE": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "VALIDATOR_ADMIN_ROLE": Web3.keccak(text="VALIDATOR_ADMIN_ROLE").hex(),
    "BGT_MANAGER_ROLE": Web3.keccak(text="BGT_MANAGER_ROLE").hex(),
    "PROTOCOL_FEE_MANAGER_ROLE": Web3.keccak(text="PROTOCOL_FEE_MANAGER_ROLE").hex(),
    "REWARDS_ALLOCATION_MANAGER_ROLE": Web3.keccak(text="REWARDS_ALLOCATION_MANAGER_ROLE").hex(),
    "COMMISSION_MANAGER_ROLE": Web3.keccak(text="COMMISSION_MANAGER_ROLE").hex(),
    "INCENTIVE_COLLECTOR_MANAGER_ROLE": Web3.keccak(text="INCENTIVE_COLLECTOR_MANAGER_ROLE").hex(),
}

# Minimal ABIs for the contracts we need
SMART_OPERATOR_ABI = [
    {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "hasRole", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}], "name": "getRoleAdmin", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "grantRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "revokeRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "protocolFeePercentage", "outputs": [{"internalType": "uint96", "name": "", "type": "uint96"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "unboostedBalance", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getEarnedBGTFeeState", "outputs": [{"internalType": "uint256", "name": "currentBalance", "type": "uint256"}, {"internalType": "uint256", "name": "bgtBalanceAlreadyCharged", "type": "uint256"}, {"internalType": "uint256", "name": "chargeableBalance", "type": "uint256"}, {"internalType": "uint96", "name": "", "type": "uint96"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "queueBoost", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "activateBoost", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint128", "name": "amount", "type": "uint128"}], "name": "queueDropBoost", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "dropBoost", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "redeemBGT", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "rewardAllocator", "type": "address"}], "name": "setRewardAllocator", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint64", "name": "startBlock", "type": "uint64"}, {"components": [{"internalType": "address", "name": "receiver", "type": "address"}, {"internalType": "uint96", "name": "percentageNumerator", "type": "uint96"}], "internalType": "struct IBeraChef.Weight[]", "name": "weights", "type": "tuple[]"}], "name": "queueRewardsAllocation", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint96", "name": "commission", "type": "uint96"}], "name": "queueValCommission", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "claimBgtStakerReward", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"components": [{"internalType": "bytes32", "name": "identifier", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}, {"internalType": "uint256", "name": "amount", "type": "uint256"}, {"internalType": "bytes32[]", "name": "merkleProof", "type": "bytes32[]"}], "internalType": "struct IBGTIncentiveDistributor.Claim[]", "name": "claims", "type": "tuple[]"}, {"internalType": "address[]", "name": "tokens", "type": "address[]"}], "name": "claimBoostRewards", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint96", "name": "protocolFeePercentage_", "type": "uint96"}], "name": "setProtocolFeePercentage", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint256", "name": "minEffectiveBalance", "type": "uint256"}], "name": "setMinEffectiveBalance", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "uint256", "name": "newPayoutAmount", "type": "uint256"}], "name": "queueIncentiveCollectorPayoutAmountChange", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "accrueEarnedBGTFees", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

STAKING_POOL_ABI = [
    {"inputs": [], "name": "activeThresholdReached", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "isActive", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "isFullyExited", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "validatorActivationBlock", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
]

FACTORY_ABI = [
    {"inputs": [{"internalType": "bytes", "name": "pubkey", "type": "bytes"}], "name": "getCoreContracts", "outputs": [{"components": [{"internalType": "address", "name": "smartOperator", "type": "address"}, {"internalType": "address", "name": "stakingPool", "type": "address"}, {"internalType": "address", "name": "stakingRewardsVault", "type": "address"}, {"internalType": "address", "name": "incentiveCollector", "type": "address"}], "internalType": "struct ICoreContractsStorage.CoreContracts", "name": "", "type": "tuple"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "withdrawalVault", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
]

BGT_ABI = [
    {"inputs": [{"internalType": "address", "name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "account", "type": "address"}], "name": "unboostedBalanceOf", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "account", "type": "address"}, {"internalType": "bytes", "name": "validator", "type": "bytes"}], "name": "boosted", "outputs": [{"internalType": "uint128", "name": "", "type": "uint128"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "account", "type": "address"}, {"internalType": "bytes", "name": "validator", "type": "bytes"}], "name": "boostedQueue", "outputs": [{"internalType": "uint32", "name": "blockNumberLast", "type": "uint32"}, {"internalType": "uint128", "name": "balance", "type": "uint128"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "account", "type": "address"}, {"internalType": "bytes", "name": "validator", "type": "bytes"}], "name": "dropBoostQueue", "outputs": [{"internalType": "uint32", "name": "blockNumberLast", "type": "uint32"}, {"internalType": "uint128", "name": "balance", "type": "uint128"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "activateBoostDelay", "outputs": [{"internalType": "uint32", "name": "", "type": "uint32"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "dropBoostDelay", "outputs": [{"internalType": "uint32", "name": "", "type": "uint32"}], "stateMutability": "view", "type": "function"},
]

BERA_CHEF_ABI = [
    {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "hasRole", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}], "name": "getRoleAdmin", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "bytes", "name": "valPubkey", "type": "bytes"}], "name": "getValCommissionOnIncentiveTokens", "outputs": [{"internalType": "uint96", "name": "", "type": "uint96"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"internalType": "bytes", "name": "valPubkey", "type": "bytes"}], "name": "valRewardAllocator", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
    {
        "inputs": [{"internalType": "bytes", "name": "valPubkey", "type": "bytes"}],
        "name": "getActiveRewardAllocation",
        "outputs": [
            {
                "components": [
                    {"internalType": "uint64", "name": "startBlock", "type": "uint64"},
                    {
                        "components": [
                            {"internalType": "address", "name": "receiver", "type": "address"},
                            {"internalType": "uint96", "name": "percentageNumerator", "type": "uint96"}
                        ],
                        "internalType": "struct IBeraChef.Weight[]",
                        "name": "weights",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeraChef.RewardAllocation",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "bytes", "name": "valPubkey", "type": "bytes"}],
        "name": "getQueuedRewardAllocation",
        "outputs": [
            {
                "components": [
                    {"internalType": "uint64", "name": "startBlock", "type": "uint64"},
                    {
                        "components": [
                            {"internalType": "address", "name": "receiver", "type": "address"},
                            {"internalType": "uint96", "name": "percentageNumerator", "type": "uint96"}
                        ],
                        "internalType": "struct IBeraChef.Weight[]",
                        "name": "weights",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeraChef.RewardAllocation",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
]


class SmartOperatorManager:
    def __init__(self, show_calldata: bool = False):
        self.show_calldata = show_calldata
        self.w3: Optional[Web3] = None
        self.account: Optional[Account] = None
        self.operator: Optional[Contract] = None
        self.bgt: Optional[Contract] = None
        self.berachef: Optional[Contract] = None
        self.factory: Optional[Contract] = None
        self.operator_address: Optional[str] = None
        self.staking_pool_address: Optional[str] = None
        self.pubkey: Optional[str] = None
        self.pubkey_bytes: Optional[bytes] = None
        self.network: Optional[str] = None
        self.roles: Dict[str, bool] = {}
        self.tx_log_path: Optional[str] = None
        self.pool_fully_exited: Optional[bool] = None

    def get_staking_pool_abi(self) -> List[Dict]:
        """Get staking pool ABI"""
        return STAKING_POOL_ABI

    def prompt_for_pubkey(self) -> str:
        """Prompt for validator pubkey, require 0x prefix, return hex without 0x."""
        while True:
            pk = Prompt.ask("Enter validator pubkey (with 0x)")
            if not pk.startswith("0x"):
                console.print("[red]Pubkey must start with 0x[/red]")
                continue
            hex_part = pk[2:]
            if len(hex_part) != 96:
                console.print("[red]Pubkey must be 96 hex characters after 0x[/red]")
                continue
            try:
                bytes.fromhex(hex_part)
            except Exception:
                console.print("[red]Pubkey contains non-hex characters[/red]")
                continue
            return hex_part

    def load_env_sh(self) -> Dict[str, str]:
        """Load configuration from env.sh if it exists"""
        env_path = Path(__file__).parent / "env.sh"
        env_vars = {}
        
        if env_path.exists():
            try:
                # Parse bash env.sh for variables
                result = subprocess.run(
                    ["bash", "-c", f"source {env_path} && env"],
                    capture_output=True,
                    text=True,
                    check=True
                )
                for line in result.stdout.splitlines():
                    if "=" in line:
                        key, value = line.split("=", 1)
                        env_vars[key] = value.strip('"').strip("'")
            except Exception as e:
                console.print(f"[yellow]Warning: Could not parse env.sh: {e}[/yellow]")
        
        return env_vars

    def get_validator_pubkey(self, beacond_home: str, beacond_bin: str = "beacond") -> Optional[str]:
        """Get validator pubkey from beacond - parses text output, not JSON"""
        import re
        try:
            result = subprocess.run(
                [beacond_bin, "--home", beacond_home, "deposit", "validator-keys"],
                capture_output=True,
                text=True,
                check=True
            )
            output = result.stdout
            
            # Try to find the line after "Eth/Beacon Pubkey (Compressed 48-byte Hex):"
            lines = output.split('\n')
            for i, line in enumerate(lines):
                if 'Eth/Beacon Pubkey' in line or 'Beacon Pubkey' in line:
                    if i + 1 < len(lines):
                        pk = lines[i + 1].strip()
                        if pk and pk.startswith('0x'):
                            return pk.replace('0x', '')
            
            # Fallback: search for hex pattern 0x[0-9a-fA-F]{96}
            match = re.search(r'0x[0-9a-fA-F]{96}', output)
            if match:
                return match.group(0).replace('0x', '')
            
            return None
        except Exception as e:
            console.print(f"[yellow]Warning: Could not get pubkey from beacond: {e}[/yellow]")
            return None

    def detect_network(self, beacond_home: str, beacond_bin: str = "beacond") -> str:
        """Detect network from beacond genesis validator-root"""
        try:
            # Try the consensus layer path first (cl/config/genesis.json)
            genesis_path = Path(beacond_home) / "config" / "genesis.json"
            if not genesis_path.exists():
                return "unknown"
            
            result = subprocess.run(
                [beacond_bin, "--home", beacond_home, "genesis", "validator-root", str(genesis_path)],
                capture_output=True,
                text=True,
                check=True
            )
            root = result.stdout.strip()
            
            if root == MAINNET_VALIDATOR_ROOT:
                return "mainnet"
            elif root == BEPOLIA_VALIDATOR_ROOT:
                return "bepolia"
            else:
                console.print(f"[yellow]Warning: Unknown validator root: {root}[/yellow]")
                return "unknown"
        except Exception as e:
            console.print(f"[yellow]Warning: Could not detect network: {e}[/yellow]")
            return "unknown"

    def connect(self):
        """Connect to network and load configuration"""
        console.print(Panel.fit("🐻 SmartOperator Manager", style="bold magenta"))
        console.print()
        
        # Load env.sh
        env_vars = self.load_env_sh()
        beacond_home = os.environ.get("BEACOND_HOME") or env_vars.get("BEACOND_HOME")
        manual_mode = False

        # Enable optional TX simulation logging if SOM_TX_LOG is set (env or env.sh)
        som_env = os.environ.get("SOM_TX_LOG") or env_vars.get("SOM_TX_LOG")
        if som_env:
            # If set to 1/true, default to /tmp path; else treat as explicit file path
            if som_env.strip().lower() in ("1", "true", "yes"):
                self.tx_log_path = "/tmp/smart-operator-tx.log"
            else:
                self.tx_log_path = som_env
            # Try to initialize the log file silently
            try:
                log_dir = os.path.dirname(self.tx_log_path)
                if log_dir:
                    os.makedirs(log_dir, exist_ok=True)
                with open(self.tx_log_path, "a") as _f:
                    _f.write("")
            except Exception:
                # Gracefully disable transaction logging if file cannot be created
                self.tx_log_path = None

        # Check for VALIDATOR_PUBKEY and CHAIN environment variables first
        validator_pubkey = os.environ.get("VALIDATOR_PUBKEY") or env_vars.get("VALIDATOR_PUBKEY")
        chain = os.environ.get("CHAIN") or env_vars.get("CHAIN")
        
        if validator_pubkey and chain:
            # Use environment variables
            self.network = chain
            console.print(f"[cyan]Network:[/cyan] {self.network}")
            if self.network not in ("mainnet", "bepolia"):
                console.print(f"[red]Error: Invalid CHAIN value: {self.network} (must be 'mainnet' or 'bepolia')[/red]")
                sys.exit(1)
            # Normalize pubkey: ensure 0x prefix, then strip for internal usage
            if not validator_pubkey.startswith("0x"):
                validator_pubkey = "0x" + validator_pubkey
            # Validate pubkey format (48 bytes = 96 hex chars)
            if not re.match(r"^0x[0-9a-fA-F]{96}$", validator_pubkey):
                console.print(f"[red]Error: Invalid VALIDATOR_PUBKEY format (must be 48-byte hex)[/red]")
                sys.exit(1)
            self.pubkey = validator_pubkey[2:]  # Strip 0x for internal usage
        elif not beacond_home or not Path(beacond_home).exists():
            console.print("[yellow]BEACOND_HOME not found. Switching to manual mode.[/yellow]")
            # Manual: choose network and enter pubkey
            self.network = questionary.select("Select network", choices=["bepolia", "mainnet"]).ask()
            if not self.network:
                console.print("[red]Cancelled[/red]")
                sys.exit(1)
            self.pubkey = self.prompt_for_pubkey()
            manual_mode = True
        else:
            # Get beacond bin
            beacond_bin = env_vars.get("BEACOND_BIN", "beacond")
            # Detect network
            self.network = self.detect_network(beacond_home, beacond_bin)
            console.print(f"[cyan]Network:[/cyan] {self.network}")
            if self.network == "unknown":
                console.print("[red]Error: Could not detect network[/red]")
                sys.exit(1)
            # Get pubkey from beacond, fallback to prompt
            self.pubkey = self.get_validator_pubkey(beacond_home, beacond_bin)
            if not self.pubkey:
                self.pubkey = self.prompt_for_pubkey()
            else:
                # beacond returns 0x-prefixed; strip for internal usage
                if self.pubkey.startswith("0x"):
                    self.pubkey = self.pubkey[2:]
        console.print(f"[cyan]Validator pubkey:[/cyan] 0x{self.pubkey}")
        
        # Connect to RPC
        self.rpc_url = env_vars.get("RPC_URL") or (
            "https://rpc.berachain.com/" if self.network == "mainnet" 
            else "https://bepolia.rpc.berachain.com/"
        )
        console.print(f"[cyan]RPC:[/cyan] {self.rpc_url}")
        
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        if not self.w3.is_connected():
            console.print("[red]Error: Could not connect to RPC[/red]")
            sys.exit(1)
        
        # Get private key
        console.print()
        private_key = os.getenv("PRIVATE_KEY")
        
        if private_key:
            console.print("[cyan]Using private key from PRIVATE_KEY environment variable[/cyan]")
        else:
            private_key = getpass.getpass("Enter private key (will not be displayed): ")
        
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        try:
            self.account = Account.from_key(private_key)
            console.print(f"[cyan]Your address:[/cyan] {self.account.address}")
        except Exception as e:
            console.print(f"[red]Error: Invalid private key: {e}[/red]")
            sys.exit(1)
        
        # Get SmartOperator address
        factory_address = Web3.to_checksum_address(FACTORY_ADDRESSES[self.network])
        self.factory = self.w3.eth.contract(address=factory_address, abi=FACTORY_ABI)
        
        console.print(f"[cyan]Looking up contracts for pubkey:[/cyan] 0x{self.pubkey}")
        
        try:
            self.pubkey_bytes = bytes.fromhex(self.pubkey)
            
            try:
                block = self.w3.eth.block_number
                console.print(f"[green]✓[/green] Connected to RPC (block: {block})")
            except Exception as rpc_error:
                console.print(f"[red]✗ RPC connection failed: {rpc_error}[/red]")
                sys.exit(1)
            
            try:
                code = self.w3.eth.get_code(factory_address)
                if code == b'' or code == b'0x':
                    console.print(f"[red]✗ Factory contract has no code at {factory_address}[/red]")
                    console.print(f"[yellow]Is this the correct network? Detected: {self.network}[/yellow]")
                    sys.exit(1)
            except Exception as code_error:
                console.print(f"[red]✗ Could not check factory code: {code_error}[/red]")
                sys.exit(1)
            
            # Now try to get contracts (tuple order per FACTORY_ABI):
            # CoreContracts { smartOperator, stakingPool, stakingRewardsVault, incentiveCollector }
            contracts = self.factory.functions.getCoreContracts(self.pubkey_bytes).call()
            self.operator_address = contracts[0]  # smartOperator is at index 0
            self.staking_pool_address = contracts[1]
            
            # Check if address is zero (not deployed)
            if self.operator_address == "0x0000000000000000000000000000000000000000":
                console.print(f"[red]✗ No contracts deployed for this pubkey[/red]")
                console.print(f"[yellow]Have you run activate.sh to deploy the staking pool?[/yellow]")
                sys.exit(1)
            
            console.print(f"[green]✓[/green] SmartOperator: {self.operator_address}")
        except Exception as e:
            console.print(f"[red]Error: Could not find SmartOperator for pubkey: {e}[/red]")
            console.print(f"[yellow]Details:[/yellow]")
            console.print(f"  Network: {self.network}")
            console.print(f"  RPC URL: {self.rpc_url}")
            console.print(f"  Factory: {factory_address}")
            console.print(f"  Pubkey: 0x{self.pubkey}")
            sys.exit(1)
        
        # Load contracts (checksum all addresses)
        self.operator = self.w3.eth.contract(address=Web3.to_checksum_address(self.operator_address), abi=SMART_OPERATOR_ABI)
        self.bgt = self.w3.eth.contract(address=Web3.to_checksum_address(BGT_ADDRESS), abi=BGT_ABI)
        self.berachef = self.w3.eth.contract(address=Web3.to_checksum_address(BERA_CHEF_ADDRESS), abi=BERA_CHEF_ABI)
        # Init staking pool contract and basic state
        try:
            self._staking_pool = self.w3.eth.contract(
                address=Web3.to_checksum_address(self.staking_pool_address),
                abi=self.get_staking_pool_abi()
            )
            self.pool_fully_exited = bool(self._staking_pool.functions.isFullyExited().call())
        except Exception as e:
            # Gracefully handle case where staking pool cannot be fetched (may not exist yet)
            self._staking_pool = None
            self.pool_fully_exited = None
        
        # Check roles
        console.print()
        console.print("[cyan]Checking your roles...[/cyan]")
        self.check_roles()
        
        if not any(self.roles.values()):
            console.print("[yellow]Warning: Your address has no roles on this SmartOperator. You can still use role tools to grant roles if you are an admin.[/yellow]")

    def log_sim(self, label: str, to_addr: str, data_hex: str, value_wei: int = 0, mode: str = "tx"):
        """Append a JSON line with minimal fields needed to simulate a call/tx."""
        if not self.tx_log_path:
            return
        try:
            entry = {
                "timestamp": int(time.time()),
                "label": label,
                "mode": mode,  # preflight | tx | show
                "network": self.network,
                "chainId": int(self.w3.eth.chain_id) if self.w3 else None,
                "from": self.account.address if self.account else None,
                "to": to_addr,
                "data": data_hex,
                "value": int(value_wei or 0),
            }
            with open(self.tx_log_path, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            # Swallow logging errors; do not interfere with normal flow
            pass

    def decode_revert(self, err: Exception) -> str:
        """Best-effort decoder for revert reasons and custom errors."""
        s = str(err)
        # Known custom errors from ISmartOperator
        custom_map = {
            '0x32e1a5be': 'StakingPoolIsFullyExited',
            '0x5bfcf715': 'InvalidProtocolFeePercentage',
            '0xd92e233d': 'ZeroAddress',
            '0xe1130dba': 'InvalidSender(address,address)',
            '0x0c32c4fa': 'AccessControlUnauthorizedAccount',
            '0x08c379a0': 'Error(string)',
            '0x4e487b71': 'Panic(uint256)'
        }
        for sig, name in custom_map.items():
            if sig in s:
                return name
        return s[:120]

    def preflight_call(self, to_addr: str, data: bytes, value_wei: int = 0) -> Optional[str]:
        try:
            call = {
                'from': self.account.address,
                'to': Web3.to_checksum_address(to_addr),
                'data': data.hex(),
                'value': value_wei
            }
            self.w3.eth.call(call)
            return None
        except Exception as e:
            return self.decode_revert(e)

    def encode_queue_val_commission_calldata(self, commission_bps: int) -> str:
        """Encode calldata for queueValCommission(uint96) without relying on ABI helpers."""
        try:
            selector = Web3.keccak(text="queueValCommission(uint96)")[:4].hex()
            arg = int(commission_bps).to_bytes(32, byteorder="big", signed=False).hex()
            return "0x" + selector + arg
        except Exception:
            # Fallback to ABI encode if available
            try:
                return self.operator.encodeABI(fn_name="queueValCommission", args=[int(commission_bps)])
            except Exception:
                return "0x"

    def check_roles(self):
        """Check which roles the account has"""
        for role_name, role_hash in ROLES.items():
            try:
                has_role = self.operator.functions.hasRole(
                    Web3.to_bytes(hexstr=role_hash),
                    self.account.address
                ).call()
                self.roles[role_name] = has_role
                if has_role:
                    console.print(f"  ✓ {role_name}")
            except Exception:
                self.roles[role_name] = False


    def display_status(self):
        """Display operator status"""
        console.print()
        console.print(Panel.fit("📊 Status Dashboard", style="bold cyan"))
        
        try:
            # Get BGT balances
            pubkey_bytes = bytes.fromhex(self.pubkey)
            bgt_balance = self.bgt.functions.balanceOf(self.operator_address).call()
            unboosted = self.bgt.functions.unboostedBalanceOf(self.operator_address).call()
            boosted = self.bgt.functions.boosted(self.operator_address, pubkey_bytes).call()
            boost_queue_block, boost_queue_amount = self.bgt.functions.boostedQueue(self.operator_address, pubkey_bytes).call()
            drop_queue_block, drop_queue_amount = self.bgt.functions.dropBoostQueue(self.operator_address, pubkey_bytes).call()
            current_block = self.w3.eth.block_number
            try:
                activate_delay = int(self.bgt.functions.activateBoostDelay().call())
            except Exception:
                # Use default if delay cannot be fetched (non-critical for display)
                activate_delay = 0
            try:
                drop_delay = int(self.bgt.functions.dropBoostDelay().call())
            except Exception:
                # Use default if delay cannot be fetched (non-critical for display)
                drop_delay = 0
            
            # Get fee state
            current_bal, already_charged, chargeable, fee_pct = self.operator.functions.getEarnedBGTFeeState().call()

            # Core contracts (combined listing)
            try:
                core_contracts = self.factory.functions.getCoreContracts(pubkey_bytes).call()
                smart_operator_addr, staking_pool_addr_core, staking_rewards_vault_addr, incentive_collector_addr = core_contracts
                withdrawal_vault_addr = self.factory.functions.withdrawalVault().call()
                console.print("[dim]Core contracts:[/dim]")
                console.print(f"[dim]  Staking Pool: {staking_pool_addr_core}[/dim]")
                console.print(f"[dim]  Smart Operator: {smart_operator_addr}[/dim]")
                console.print(f"[dim]  Staking Rewards Vault: {staking_rewards_vault_addr}[/dim]")
                console.print(f"[dim]  Incentive Collector: {incentive_collector_addr}[/dim]")
                console.print(f"[dim]  Withdrawal Vault: {withdrawal_vault_addr}[/dim]")
            except Exception:
                pass

            # Get commission and reward allocation/allocator from BeraChef
            commission_pct_display = None
            reward_allocator_addr = None
            allocation_rows: List[str] = []
            allocation_start_block = None
            # Commission: try the correct function
            try:
                commission_bps = int(self.berachef.functions.getValCommissionOnIncentiveTokens(pubkey_bytes).call())
                commission_pct_display = f"{commission_bps / 100:.2f}%"
            except Exception as e:
                # Commission lookup failed
                commission_pct_display = None
            if commission_pct_display is None:
                commission_pct_display = "unknown"
            try:
                reward_allocator_addr = self.berachef.functions.valRewardAllocator(pubkey_bytes).call()
                if reward_allocator_addr == "0x0000000000000000000000000000000000000000":
                    reward_allocator_addr = None
            except Exception:
                reward_allocator_addr = None
            # Try active allocation with start block
            try:
                res = self.berachef.functions.getActiveRewardAllocation(pubkey_bytes).call()
                if isinstance(res, (list, tuple)) and len(res) == 2:
                    allocation_start_block, weights = res
                else:
                    weights = []
                if weights:
                    all_vault_addresses = [w[0] for w in weights]
                    vault_names_map = self.get_vault_names_from_api(all_vault_addresses)
                for w in weights:
                    receiver, pct_num = w[0], int(w[1])
                    vname = vault_names_map.get(receiver) if 'vault_names_map' in locals() else None
                    display = f"{vname} ({receiver})" if vname else receiver
                    allocation_rows.append(f"{display} → {pct_num/100:.2f}%")
            except Exception:
                # Try simple getter returning only weights
                try:
                    weights_only = self.berachef.functions.getRewardAllocation(pubkey_bytes).call()
                    if weights_only:
                        all_vault_addresses = [w[0] for w in weights_only]
                        vault_names_map = self.get_vault_names_from_api(all_vault_addresses)
                    for w in weights_only:
                        receiver, pct_num = w[0], int(w[1])
                        vname = vault_names_map.get(receiver) if 'vault_names_map' in locals() else None
                        display = f"{vname} ({receiver})" if vname else receiver
                        allocation_rows.append(f"{display} → {pct_num/100:.2f}%")
                except Exception:
                    allocation_rows = []
            
            # Display in table
            table = Table(box=box.ROUNDED)
            table.add_column("Metric", style="cyan")
            table.add_column("Value", style="green")
            
            table.add_row("Total BGT Balance", f"{Web3.from_wei(bgt_balance, 'ether'):.4f} BGT")
            table.add_row("Unboosted BGT", f"{Web3.from_wei(unboosted, 'ether'):.4f} BGT")
            table.add_row("Boosted BGT", f"{Web3.from_wei(boosted, 'ether'):.4f} BGT")
            
            if boost_queue_amount > 0:
                available_block = int(boost_queue_block) + int(activate_delay)
                remaining = max(0, available_block - int(current_block))
                table.add_row(
                    "Queued Boost",
                    f"{Web3.from_wei(boost_queue_amount, 'ether'):.4f} BGT (queued at {boost_queue_block}; activate at {available_block}; ~{remaining} blocks)",
                    style="yellow",
                )
            
            if drop_queue_amount > 0:
                available_drop_block = int(drop_queue_block) + int(drop_delay)
                remaining_drop = max(0, available_drop_block - int(current_block))
                table.add_row(
                    "Queued Drop",
                    f"{Web3.from_wei(drop_queue_amount, 'ether'):.4f} BGT (queued at {drop_queue_block}; drop at {available_drop_block}; ~{remaining_drop} blocks)",
                    style="yellow",
                )
            
            table.add_row("Protocol Fee", f"{fee_pct / 100:.2f}%")
            table.add_row("Chargeable BGT", f"{Web3.from_wei(chargeable, 'ether'):.4f} BGT")

            # Commission
            table.add_row("Validator Commission", commission_pct_display if commission_pct_display else "unknown")
            # Reward allocator
            if reward_allocator_addr:
                table.add_row("Reward Allocator", reward_allocator_addr)
            # Reward allocation weights
            if allocation_rows:
                if allocation_start_block is not None:
                    table.add_row("Allocation Start Block", str(allocation_start_block))
                table.add_row("Reward Allocation", "\n".join(allocation_rows))
            # Queued allocation (if any)
            try:
                q_res = self.berachef.functions.getQueuedRewardAllocation(pubkey_bytes).call()
                if isinstance(q_res, (list, tuple)) and len(q_res) == 2:
                    q_start_block, q_weights = q_res
                    if q_weights:
                        q_addresses = [w[0] for w in q_weights]
                        q_names_map = self.get_vault_names_from_api(q_addresses)
                        q_rows: List[str] = []
                        for w in q_weights:
                            q_receiver, q_pct_num = w[0], int(w[1])
                            q_name = q_names_map.get(q_receiver)
                            q_display = f"{q_name} ({q_receiver})" if q_name else q_receiver
                            q_rows.append(f"{q_display} → {q_pct_num/100:.2f}%")
                        table.add_row("Queued Start Block", str(q_start_block))
                        table.add_row("Queued Allocation", "\n".join(q_rows))
            except Exception:
                pass
            
            # Add withdrawal availability information
            try:
                # Get staking pool contract (stakingPool is at index 1)
                staking_pool_addr = self.factory.functions.getCoreContracts(pubkey_bytes).call()[1]
                if staking_pool_addr != "0x0000000000000000000000000000000000000000":
                    staking_pool = self.w3.eth.contract(
                        address=staking_pool_addr,
                        abi=self.get_staking_pool_abi()
                    )
                    
                    # Check withdrawal availability
                    active_threshold_reached = staking_pool.functions.activeThresholdReached().call()
                    is_active = staking_pool.functions.isActive().call()
                    is_fully_exited = staking_pool.functions.isFullyExited().call()
                    
                    table.add_row("Staking Pool", staking_pool_addr)
                    table.add_row("Pool Active", "✅ Yes" if is_active else "❌ No")
                    table.add_row("Threshold Reached", "✅ Yes" if active_threshold_reached else "❌ No")
                    table.add_row("Fully Exited", "✅ Yes" if is_fully_exited else "❌ No")
                    
                    # Get total supply of shares
                    try:
                        total_supply = staking_pool.functions.totalSupply().call()
                        table.add_row("Total Shares (stBERA)", f"{Web3.from_wei(total_supply, 'ether'):.6f}")
                    except Exception:
                        # Total supply may not be available (optional display field)
                        pass
                    
            except Exception as e:
                table.add_row("Pool Status", f"❌ Error: {str(e)[:50]}...")
            
            console.print(table)
            
        except Exception as e:
            console.print(f"[red]Error fetching status: {e}[/red]")

    def execute_or_show_calldata(self, func_name: str, tx_data: Dict):
        """Execute transaction or show calldata"""
        if self.show_calldata:
            console.print()
            console.print(Panel.fit("📋 Transaction Calldata", style="bold yellow"))
            console.print(f"[cyan]To:[/cyan] {self.operator_address}")
            console.print(f"[cyan]Data:[/cyan] {tx_data['data']}")
            console.print(f"[cyan]Value:[/cyan] {tx_data.get('value', 0)} wei")
            # Log simulated (show-only) transaction for external simulation
            try:
                self.log_sim(func_name, self.operator_address, tx_data['data'], tx_data.get('value', 0), mode="show")
            except Exception:
                # Logging failures should not block transaction preview
                pass
            return False
        
        # Show transaction details (quiet)
        console.print()
        console.print(Panel.fit(f"🔄 Executing: {func_name}", style="bold yellow"))
        
        # Estimate gas
        try:
            gas_estimate = self.w3.eth.estimate_gas({
                'from': self.account.address,
                'to': self.operator_address,
                'data': tx_data['data']
            })
            console.print(f"[cyan]Estimated gas:[/cyan] {gas_estimate}")
        except Exception as e:
            console.print(f"[yellow]Warning: Could not estimate gas: {e}[/yellow]")
            gas_estimate = 500000

        # Always log the intended tx for simulation before prompting
        try:
            self.log_sim(func_name, self.operator_address, tx_data['data'], tx_data.get('value', 0), mode="tx")
        except Exception:
            pass
        
        if not Confirm.ask("Execute this transaction?"):
            console.print("[yellow]Transaction cancelled[/yellow]")
            return False
        
        # Build and send transaction
        try:
            nonce = self.w3.eth.get_transaction_count(self.account.address)
            gas_price = self.w3.eth.gas_price
            
            tx = {
                'from': self.account.address,
                'to': self.operator_address,
                'data': tx_data['data'],
                'gas': gas_estimate,
                'gasPrice': gas_price,
                'nonce': nonce,
                'chainId': self.w3.eth.chain_id,
            }
            # (Already logged above)
            
            signed_tx = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            console.print(f"[green]✓ Transaction sent: {tx_hash.hex()}[/green]")
            console.print("[cyan]Waiting for confirmation...[/cyan]")
            
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt['status'] == 1:
                console.print(f"[green]✓ Transaction confirmed in block {receipt['blockNumber']}[/green]")
                return True
            else:
                console.print("[red]✗ Transaction failed[/red]")
                return False
        except Exception as e:
            console.print(f"[red]Error executing transaction: {e}[/red]")
            return False

    def queue_boost_action(self):
        """Queue boost for unboosted BGT"""
        if self.pool_fully_exited:
            console.print("[red]Pool is fully exited; boosting is disabled.[/red]")
            return
        console.print("[cyan]Queuing boost for unboosted BGT...[/cyan]")
        # Preflight: show unboosted and queued state
        try:
            unboosted = self.bgt.functions.unboostedBalanceOf(self.operator_address).call()
            q_block, q_amt = self.bgt.functions.boostedQueue(self.operator_address, self.pubkey_bytes).call()
            console.print(f"[dim]Unboosted: {Web3.from_wei(unboosted, 'ether')} BGT; Queued: {Web3.from_wei(q_amt, 'ether')} BGT[/dim]")
            if unboosted == 0:
                console.print("[yellow]Nothing to boost (unboosted = 0).[/yellow]")
                return
        except Exception:
            pass
        # Preflight via eth_call
        try:
            self.operator.functions.queueBoost().call({'from': self.account.address})
        except Exception as e:
            console.print(f"[red]Preflight revert:[/red] {self.decode_revert(e)}")
            return
        tx_data = self.operator.functions.queueBoost().build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("queueBoost", tx_data)

    def activate_boost_action(self):
        """Activate queued boost"""
        console.print("[cyan]Activating queued boost...[/cyan]")
        tx_data = self.operator.functions.activateBoost().build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("activateBoost", tx_data)

    def queue_drop_boost_action(self):
        """Queue drop boost"""
        amount_bgt = Prompt.ask("Enter amount of BGT to unboost")
        try:
            amount_wei = self.w3.to_wei(amount_bgt, 'ether')
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
            return
        # Preflight
        try:
            self.operator.functions.queueDropBoost(amount_wei).call({'from': self.account.address})
        except Exception as e:
            console.print(f"[red]Preflight revert:[/red] {self.decode_revert(e)}")
            return
        tx_data = self.operator.functions.queueDropBoost(amount_wei).build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("queueDropBoost", tx_data)

    def drop_boost_action(self):
        """Execute drop boost"""
        console.print("[cyan]Executing queued drop boost...[/cyan]")
        # Preflight
        try:
            self.operator.functions.dropBoost().call({'from': self.account.address})
        except Exception as e:
            console.print(f"[red]Preflight revert:[/red] {self.decode_revert(e)}")
            return
        tx_data = self.operator.functions.dropBoost().build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("dropBoost", tx_data)

    def redeem_bgt_action(self):
        """Redeem BGT for BERA"""
        # Show balances
        try:
            total_bgt = self.bgt.functions.balanceOf(self.operator_address).call()
            unboosted_bgt = self.bgt.functions.unboostedBalanceOf(self.operator_address).call()
            console.print(f"[cyan]Current BGT:[/cyan] {Web3.from_wei(total_bgt, 'ether')} (total), {Web3.from_wei(unboosted_bgt, 'ether')} (unboosted)")
        except Exception:
            total_bgt = 0
            unboosted_bgt = 0
        # Offer to queue drop boost for all boosted first if nothing unboosted
        try:
            pubkey_bytes = bytes.fromhex(self.pubkey)
            boosted_amt = self.bgt.functions.boosted(self.operator_address, pubkey_bytes).call()
        except Exception:
            boosted_amt = 0
        if unboosted_bgt == 0 and boosted_amt > 0:
            if Confirm.ask("No unboosted BGT available. Queue drop boost for all boosted first?"):
                tx_data = self.operator.functions.queueDropBoost(boosted_amt).build_transaction({'from': self.account.address})
                self.execute_or_show_calldata("queueDropBoost", tx_data)
                console.print("[yellow]Drop boost queued. Wait for delay, then execute 'Execute Drop Boost' and try redeem again.[/yellow]")
                return

        amount_bgt = Prompt.ask("Enter amount of BGT to redeem (number or 'all')", default="all")
        try:
            if amount_bgt.strip().lower() in ("all", "max"):
                amount_wei = unboosted_bgt
                if amount_wei == 0:
                    console.print("[yellow]No unboosted BGT available to redeem. Queue/activate drop boost first.[/yellow]")
                    return
            else:
                amount_wei = self.w3.to_wei(amount_bgt, 'ether')
                if amount_wei <= 0:
                    console.print("[red]Amount must be greater than 0[/red]")
                    return
                if total_bgt and amount_wei > total_bgt:
                    console.print("[red]Amount exceeds total BGT balance[/red]")
                    return
                if unboosted_bgt and amount_wei > unboosted_bgt:
                    shortfall = amount_wei - unboosted_bgt
                    shortfall_bgt = Web3.from_wei(shortfall, 'ether')
                    console.print(f"[yellow]Requested exceeds unboosted by {shortfall_bgt} BGT[/yellow]")
                    if Confirm.ask("Queue drop boost for the shortfall now?"):
                        tx_q = self.operator.functions.queueDropBoost(shortfall).build_transaction({'from': self.account.address})
                        if not self.execute_or_show_calldata("queueDropBoost", tx_q):
                            return
                        console.print("[yellow]Drop boost queued. Wait for delay, execute 'Execute Drop Boost', then redeem again.[/yellow]")
                    return
            # Preflight redeem
            try:
                self.operator.functions.redeemBGT(amount_wei).call({'from': self.account.address})
            except Exception as e:
                console.print(f"[red]Preflight revert:[/red] {self.decode_revert(e)}")
                return
            tx_data = self.operator.functions.redeemBGT(amount_wei).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("redeemBGT", tx_data)
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def set_reward_allocator_action(self):
        """Set reward allocator address"""
        allocator = Prompt.ask("Enter reward allocator address")
        if not self.w3.is_address(allocator):
            console.print("[red]Invalid address[/red]")
            return
        
        tx_data = self.operator.functions.setRewardAllocator(allocator).build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("setRewardAllocator", tx_data)

    def register_as_operator_action(self):
        """Register SmartOperator as its own reward allocator (operator)"""
        console.print("[yellow]This will register the SmartOperator as the validator operator on BeraChef.[/yellow]")
        console.print(f"[dim]SmartOperator: {self.operator_address}[/dim]")
        console.print(f"[dim]Validator pubkey: {self.pubkey}[/dim]")
        
        if not Confirm.ask("Continue?"):
            return
        
        try:
            # Set the SmartOperator as its own reward allocator
            tx_data = self.operator.functions.setRewardAllocator(self.operator_address).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("setRewardAllocator (self)", tx_data)
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def queue_commission_action(self):
        """Queue validator commission change"""
        commission_pct = Prompt.ask("Enter validator commission percentage (0-20)")
        try:
            commission_bps = int(round(float(commission_pct) * 100))
            if commission_bps < 0 or commission_bps > 2000:
                console.print("[red]Commission must be between 0 and 20%[/red]")
                return
            # Check that SmartOperator has permission on BeraChef
            try:
                chef_has_role = self.berachef.functions.hasRole(
                    Web3.to_bytes(hexstr=ROLES["COMMISSION_MANAGER_ROLE"]),
                    Web3.to_checksum_address(self.operator_address)
                ).call()
            except Exception:
                chef_has_role = None
            if chef_has_role is False:
                console.print("[red]BeraChef denies SmartOperator: missing COMMISSION_MANAGER_ROLE on BeraChef for this operator.[/red]")
                try:
                    admin = self.berachef.functions.getRoleAdmin(Web3.to_bytes(hexstr=ROLES["COMMISSION_MANAGER_ROLE"])).call()
                    console.print(f"[yellow]BeraChef admin for COMMISSION_MANAGER_ROLE:[/yellow] {admin.hex() if isinstance(admin, (bytes, bytearray)) else admin}")
                except Exception:
                    pass
                return
            # Preflight: SmartOperator.onlyRole checks signer, not operator. So we do two preflights:
            # 1) hasRole(COMMISSION_MANAGER_ROLE, signer)
            try:
                has_role = self.operator.functions.hasRole(
                    Web3.to_bytes(hexstr=ROLES["COMMISSION_MANAGER_ROLE"]),
                    self.account.address
                ).call()
            except Exception as e:
                has_role = False
            if not has_role:
                console.print("[red]You do not have COMMISSION_MANAGER_ROLE on this SmartOperator.[/red]")
                return
            # Require allocator is set and signer role present before preflight
            try:
                allocator = self.berachef.functions.valRewardAllocator(self.pubkey_bytes).call()
                if allocator.lower() != self.operator_address.lower():
                    console.print("[red]SmartOperator is not registered as validator operator on BeraChef.[/red]")
                    return
            except Exception:
                pass
            try:
                has_role = self.operator.functions.hasRole(
                    Web3.to_bytes(hexstr=ROLES["COMMISSION_MANAGER_ROLE"]),
                    self.account.address
                ).call()
                if not has_role:
                    console.print("[red]You do not have COMMISSION_MANAGER_ROLE on this SmartOperator.[/red]")
                    return
            except Exception:
                pass
            try:
                self.operator.functions.queueValCommission(commission_bps).call({'from': self.account.address})
                console.print("[green]✅ Preflight check passed[/green]")
            except Exception as preflight:
                reason = self.decode_revert(preflight)
                console.print(f"[red]Preflight revert:[/red] {reason}")
                if 'AccessControlUnauthorizedAccount' in reason:
                    console.print("[yellow]Hint: SmartOperator must be registered as validator operator on BeraChef and hold COMMISSION_MANAGER_ROLE.[/yellow]")
                return
            tx_data = self.operator.functions.queueValCommission(commission_bps).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("queueValCommission", tx_data)
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def queue_rewards_allocation_action(self):
        """Queue new rewards allocation weights"""
        console.print("[cyan]Queueing new rewards allocation...[/cyan]")
        try:
            current_block = self.w3.eth.block_number
        except Exception:
            current_block = 0

        default_start = str(current_block + 100 if current_block else 0)
        start_block_str = Prompt.ask("Enter start block (when allocation becomes active)", default=default_start)
        try:
            start_block = int(start_block_str)
            if start_block < 0:
                console.print("[red]Start block must be non-negative[/red]")
                return
        except ValueError:
            console.print("[red]Invalid start block[/red]")
            return

        console.print("[cyan]Enter receiver addresses and percentages. Total must equal 100%. Leave address blank to finish.[/cyan]")
        weights: List[Tuple[str, int]] = []
        total_bps = 0
        idx = 1
        while True:
            receiver = Prompt.ask(f"Receiver #{idx} address (0x..., blank to finish)", default="")
            if receiver.strip() == "":
                break
            if not self.w3.is_address(receiver):
                console.print("[red]Invalid address[/red]")
                continue
            pct = Prompt.ask(f"Percentage for receiver #{idx} (0-100, e.g., 12.5)")
            try:
                pct_float = float(pct)
            except ValueError:
                console.print("[red]Invalid percentage[/red]")
                continue
            if pct_float < 0 or pct_float > 100:
                console.print("[red]Percentage must be between 0 and 100[/red]")
                continue
            bps = int(round(pct_float * 100))
            if total_bps + bps > 10000:
                console.print("[red]Total exceeds 100%. Adjust values.[/red]")
                continue
            weights.append((Web3.to_checksum_address(receiver), bps))
            total_bps += bps
            idx += 1
            console.print(f"[cyan]Current total:[/cyan] {total_bps/100:.2f}%")

        if total_bps != 10000 or len(weights) == 0:
            console.print("[red]Total must equal 100%. No changes queued.[/red]")
            return

        # Build transaction
        try:
            tx_data = self.operator.functions.queueRewardsAllocation(start_block, weights).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("queueRewardsAllocation", tx_data)
        except Exception as e:
            console.print(f"[red]Error building transaction: {e}[/red]")

    def claim_bgt_staker_reward_action(self):
        """Claim BGTStaker HONEY rewards"""
        console.print("[yellow]Note: Consider using 'Claim Boost Rewards' instead, which handles both HONEY and incentive tokens.[/yellow]")
        console.print("[cyan]Claiming BGTStaker rewards (HONEY)...[/cyan]")
        tx_data = self.operator.functions.claimBgtStakerReward().build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("claimBgtStakerReward", tx_data)

    def claim_boost_rewards_action(self):
        """Claim boost rewards (HONEY + incentive tokens) and forward to IncentiveCollector"""
        console.print("[cyan]Claim Boost Rewards[/cyan]")
        console.print("This function claims HONEY rewards from BGT staking and incentive tokens from the boost program,")
        console.print("then forwards all tokens to IncentiveCollector.\n")
        
        # Get merkle claims (can be empty)
        console.print("[yellow]Merkle Claims (for incentive program rewards)[/yellow]")
        console.print("Enter merkle claims in JSON format, or press Enter for empty array.")
        console.print("Format: [{\"identifier\": \"0x...\", \"account\": \"0x...\", \"amount\": \"0x...\", \"merkleProof\": [\"0x...\", ...]}, ...]")
        claims_input = Prompt.ask("Merkle claims (JSON array)", default="[]")
        
        try:
            import json
            claims_data = json.loads(claims_input)
            if not isinstance(claims_data, list):
                console.print("[red]Claims must be a JSON array[/red]")
                return
            
            # Convert claims to the proper format
            claims = []
            for claim in claims_data:
                if not all(k in claim for k in ["identifier", "account", "amount", "merkleProof"]):
                    console.print("[red]Each claim must have identifier, account, amount, and merkleProof[/red]")
                    return
                claims.append((
                    bytes.fromhex(claim["identifier"][2:]) if claim["identifier"].startswith("0x") else bytes.fromhex(claim["identifier"]),
                    self.w3.to_checksum_address(claim["account"]),
                    int(claim["amount"], 16) if isinstance(claim["amount"], str) and claim["amount"].startswith("0x") else int(claim["amount"]),
                    [bytes.fromhex(p[2:]) if p.startswith("0x") else bytes.fromhex(p) for p in claim["merkleProof"]]
                ))
        except json.JSONDecodeError:
            console.print("[red]Invalid JSON format[/red]")
            return
        except Exception as e:
            console.print(f"[red]Error parsing claims: {e}[/red]")
            return
        
        # Get token addresses (can be empty, but should include common tokens)
        console.print("\n[yellow]Token Addresses[/yellow]")
        console.print("Enter token addresses to forward (comma-separated), or press Enter to forward all common tokens.")
        console.print("Common tokens: HONEY, BERA, and any incentive tokens you've received.")
        tokens_input = Prompt.ask("Token addresses (comma-separated, or Enter for auto-detect)", default="")
        
        if tokens_input.strip():
            token_addresses = [self.w3.to_checksum_address(addr.strip()) for addr in tokens_input.split(",")]
        else:
            # Auto-detect: try to get common token addresses
            # For now, we'll use an empty array and let the contract handle it
            # In practice, operators should specify tokens they know they have
            console.print("[yellow]No tokens specified. The function will forward tokens based on merkle claims.[/yellow]")
            console.print("If you have accumulated tokens, you may want to specify their addresses.")
            token_addresses = []
        
        try:
            console.print(f"\n[cyan]Preparing transaction with {len(claims)} claim(s) and {len(token_addresses)} token(s)...[/cyan]")
            tx_data = self.operator.functions.claimBoostRewards(claims, token_addresses).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("claimBoostRewards", tx_data)
        except Exception as e:
            console.print(f"[red]Error building transaction: {e}[/red]")
            console.print("[yellow]Tip: Make sure merkle claims are valid and token addresses are correct.[/yellow]")

    def set_protocol_fee_action(self):
        """Set protocol fee percentage"""
        fee_pct = Prompt.ask("Enter protocol fee percentage (0-20)")
        try:
            fee_bps = int(float(fee_pct) * 100)
            if fee_bps < 0 or fee_bps > 2000:
                console.print("[red]Fee must be between 0 and 20%[/red]")
                return
            
            tx_data = self.operator.functions.setProtocolFeePercentage(fee_bps).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("setProtocolFeePercentage", tx_data)
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def set_min_effective_balance_action(self):
        """Set minimum effective balance"""
        balance = Prompt.ask("Enter minimum effective balance in BERA")
        try:
            balance_wei = self.w3.to_wei(balance, 'ether')
            tx_data = self.operator.functions.setMinEffectiveBalance(balance_wei).build_transaction({'from': self.account.address})
            self.execute_or_show_calldata("setMinEffectiveBalance", tx_data)
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def accrue_fees_action(self):
        """Manually accrue earned BGT fees"""
        if self.pool_fully_exited is True:
            console.print("[red]Pool is fully exited; accruing earned BGT fees is disabled.[/red]")
            return
        console.print("[cyan]Accruing earned BGT fees...[/cyan]")
        # Preflight simulate so we can decode revert instead of raw selector
        try:
            self.operator.functions.accrueEarnedBGTFees().call({'from': self.account.address})
        except Exception as e:
            console.print(f"[red]Preflight revert:[/red] {self.decode_revert(e)}")
            return
        tx_data = self.operator.functions.accrueEarnedBGTFees().build_transaction({'from': self.account.address})
        self.execute_or_show_calldata("accrueEarnedBGTFees", tx_data)

    def view_reward_allocation_action(self):
        """View current reward allocation from BeraChef"""
        try:
            console.print()
            console.print(Panel.fit("📊 Reward Allocation Status", style="bold cyan"))
            
            # Get BeraChef contract
            bera_chef_abi = [
                {"inputs": [{"internalType": "bytes", "name": "pubkey", "type": "bytes"}], "name": "valRewardAllocator", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
                {"inputs": [{"internalType": "bytes", "name": "pubkey", "type": "bytes"}], "name": "getValCommissionOnIncentiveTokens", "outputs": [{"internalType": "uint96", "name": "", "type": "uint96"}], "stateMutability": "view", "type": "function"},
                {"inputs": [{"internalType": "bytes", "name": "pubkey", "type": "bytes"}], "name": "getActiveRewardAllocation", "outputs": [{"internalType": "uint64", "name": "startBlock", "type": "uint64"}, {"components": [{"internalType": "address", "name": "receiver", "type": "address"}, {"internalType": "uint96", "name": "percentageNumerator", "type": "uint96"}], "internalType": "struct IBeraChef.Weight[]", "name": "weights", "type": "tuple[]"}], "stateMutability": "view", "type": "function"},
            ]
            
            bera_chef = self.w3.eth.contract(
                address=Web3.to_checksum_address("0xdf960E8F3F19C481dDE769edEDD439ea1a63426a"),
                abi=bera_chef_abi
            )
            
            table = Table(show_header=True, header_style="bold magenta")
            table.add_column("Property", style="cyan")
            table.add_column("Value", style="white")
            
            # Convert pubkey to bytes
            pubkey_bytes = bytes.fromhex(self.pubkey)
            
            # Get reward allocator
            try:
                reward_allocator = bera_chef.functions.valRewardAllocator(pubkey_bytes).call()
                table.add_row("Reward Allocator", reward_allocator)
            except Exception as e:
                table.add_row("Reward Allocator", f"❌ Error: {str(e)[:50]}...")
            
            # Get validator commission
            try:
                commission = bera_chef.functions.getValCommissionOnIncentiveTokens(pubkey_bytes).call()
                commission_bps = commission / 100  # Convert from basis points to percentage
                table.add_row("Validator Commission", f"{commission_bps:.2f}% ({commission} bps)")
            except Exception as e:
                table.add_row("Validator Commission", f"❌ Error: {str(e)[:50]}...")
            
            # Get reward allocation
            try:
                result = bera_chef.functions.getActiveRewardAllocation(pubkey_bytes).call()
                # The result is a struct with startBlock and weights
                start_block = result[0]
                weights = result[1]
                
                table.add_row("Allocation Start Block", str(start_block))
                
                if weights:
                    table.add_row("Allocation Weights", f"{len(weights)} recipients")
                    for i, weight in enumerate(weights):
                        recipient, weight_value = weight
                        weight_percent = (weight_value / 10000) * 100  # Convert from basis points
                        
                        # Try to get vault name from API
                        vault_name = self.get_vault_name_from_api(recipient)
                        if vault_name:
                            display_name = f"{vault_name} ({recipient})"
                        else:
                            display_name = recipient
                        
                        table.add_row(f"  Recipient {i+1}", f"{display_name} ({weight_percent:.2f}%)")
                else:
                    table.add_row("Allocation Weights", "No allocation set")
            except Exception as e:
                table.add_row("Reward Allocation", f"❌ Error: {str(e)[:50]}...")
            
            console.print(table)
            
        except Exception as e:
            console.print(f"[red]Error viewing reward allocation: {e}[/red]")

    def get_individual_vault_names(self, vault_addresses):
        """Get individual vault names (for reward vaults, not pool vaults)"""
        # Known individual vault names for Bepolia
        known_vaults = {
            "0x57aBe4e0C59a650a7042e18493179dd5b91a3F61": "Bepolia Foundation Vault #1",
            "0xae461ea8238df1bd63B3f93b0EF7da1A56De2f91": "Bepolia Foundation Vault #2", 
            "0x45450D1E3bfd42E224976a7a263F7e59AB9607C8": "Bepolia Foundation Vault #3",
            "0x3bcED9bC841a862716d58560c07480c203e61912": "Bepolia Foundation Vault #4",
            "0x668b25f09D1f505b774bb5F686874c401EE22730": "Bepolia Foundation Vault #5",
            "0xBA0DDC0C0a8cBCccd9819e59368Dc133D362415C": "Bepolia Foundation Vault #6",
            "0x005f3019690310D0Afea6051a5133E0b9207D9b6": "Bepolia Foundation Vault #7"
        }
        
        # Match case-insensitively
        known_lower = {addr.lower(): name for addr, name in known_vaults.items()}
        result = {}
        for addr in vault_addresses:
            result[addr] = known_lower.get(addr.lower())
        
        return result

    def get_vault_names_from_api(self, vault_addresses):
        """Get vault names from Berachain API for multiple addresses"""
        try:
            import requests
            
            # Initialize cache if it doesn't exist
            if not hasattr(self, '_vault_names_cache'):
                self._vault_names_cache = {}
            
            # Check cache; treat None values as missing so we can re-resolve
            missing_addresses = [
                addr for addr in vault_addresses
                if (addr not in self._vault_names_cache) or (self._vault_names_cache.get(addr) is None)
            ]
            if not missing_addresses:
                return {addr: self._vault_names_cache.get(addr) for addr in vault_addresses}
            
            # Use network-specific API endpoint
            api_url = "https://bepolia-api.berachain.com" if self.network == "bepolia" else "https://api.berachain.com"
            
            # GraphQL query to get all pools with their vault information
            query = """
            query GetAllPools {
              poolGetPools(
                first: 1000
                orderBy: totalLiquidity
                orderDirection: desc
              ) {
                id
                name
                address
                rewardVault {
                  vaultAddress
                  stakingTokenAddress
                }
              }
            }
            """
            
            response = requests.post(
                api_url,
                json={
                    "query": query
                },
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                timeout=10
            )
            
            # Build result map initialized as None
            result = {addr: None for addr in vault_addresses}

            # Try pool mapping first
            if response.status_code == 200:
                try:
                    data = response.json()
                    pools = (data.get("data", {}) or {}).get("poolGetPools") or []
                    if isinstance(pools, list):
                        vault_to_name = {}
                        for pool in pools:
                            rv = (pool.get("rewardVault") or {})
                            vaddr = (rv.get("vaultAddress") or "").lower()
                            if vaddr:
                                vault_to_name[vaddr] = pool.get("name", f"Pool {pool.get('id', 'Unknown')}")
                        for addr in vault_addresses:
                            result[addr] = result[addr] or vault_to_name.get(addr.lower())
                except Exception:
                    pass

            # Merge known individual names regardless of pool result
            try:
                individual_names = self.get_individual_vault_names(vault_addresses)
                for addr, name in individual_names.items():
                    if name:
                        result[addr] = name
            except Exception:
                pass

            # Final fallback: confirm individual reward vaults via API
            try:
                if self.network in ("bepolia", "mainnet"):
                    chain_var = "BEPOLIA" if self.network == "bepolia" else "MAINNET"
                    gql = {
                        "query": """
                        query GetRewardVault($chain: GqlChain!, $vaultAddress: String!) {
                          polGetRewardVault(chain: $chain, vaultAddress: $vaultAddress) {
                            vaultAddress
                          }
                        }
                        """
                    }
                    for addr in vault_addresses:
                        if not result.get(addr):
                            try:
                                resp = requests.post(
                                    api_url,
                                    json={
                                        "query": gql["query"],
                                        "variables": {"chain": chain_var, "vaultAddress": addr}
                                    },
                                    headers={"Content-Type": "application/json", "Accept": "application/json"},
                                    timeout=10
                                )
                                if resp.status_code == 200:
                                    data2 = resp.json()
                                    node = (data2.get("data", {}) or {}).get("polGetRewardVault")
                                    if node and (node.get("vaultAddress") or "").lower() == addr.lower():
                                        result[addr] = "Individual Reward Vault"
                            except Exception:
                                pass
            except Exception:
                pass

            # Cache and return
            self._vault_names_cache.update(result)
            return result
            
        except Exception:
            # If API call fails, return empty dict (will fall back to addresses)
            return {}

    def get_vault_name_from_api(self, vault_address):
        """Get vault name from Berachain API (single address - uses cached data)"""
        if not hasattr(self, '_vault_names_cache'):
            self._vault_names_cache = {}
        
        if vault_address not in self._vault_names_cache:
            # Fetch all vault names at once
            all_names = self.get_vault_names_from_api([vault_address])
            self._vault_names_cache.update(all_names)
        
        return self._vault_names_cache.get(vault_address)

    def view_vault_info_action(self):
        """View vault information from BeraChef reward allocation"""
        try:
            console.print()
            console.print(Panel.fit("🏦 Vault Information", style="bold cyan"))
            
            # Get validator pubkey
            pubkey_bytes = bytes.fromhex(self.pubkey)
            
            # Get core contract addresses from factory for reference
            try:
                core_contracts = self.factory.functions.getCoreContracts(pubkey_bytes).call()
                smart_operator, staking_pool, staking_rewards_vault, incentive_collector = core_contracts
                withdrawal_vault = self.factory.functions.withdrawalVault().call()
                
                # Create mapping of addresses to contract types
                contract_types = {
                    staking_pool.lower(): "Staking Pool",
                    smart_operator.lower(): "Smart Operator", 
                    staking_rewards_vault.lower(): "Staking Rewards Vault",
                    incentive_collector.lower(): "Incentive Collector",
                    withdrawal_vault.lower(): "Withdrawal Vault"
                }
                
                console.print(f"[dim]Core contracts for reference:[/dim]")
                console.print(f"[dim]  Staking Pool: {staking_pool}[/dim]")
                console.print(f"[dim]  Smart Operator: {smart_operator}[/dim]")
                console.print(f"[dim]  Staking Rewards Vault: {staking_rewards_vault}[/dim]")
                console.print(f"[dim]  Incentive Collector: {incentive_collector}[/dim]")
                console.print(f"[dim]  Withdrawal Vault: {withdrawal_vault}[/dim]")
                
                if staking_pool == "0x0000000000000000000000000000000000000000":
                    console.print(f"[yellow]⚠️  All core contracts are 0x0000...0000 - contracts may not be deployed for this validator[/yellow]")
                
                console.print()
                
            except Exception as e:
                console.print(f"[yellow]Could not get core contracts: {e}[/yellow]")
                contract_types = {}
            
            # Get active reward allocation from BeraChef
            try:
                res = self.berachef.functions.getActiveRewardAllocation(pubkey_bytes).call()
                if isinstance(res, (list, tuple)) and len(res) == 2:
                    allocation_start_block = res[0]
                    weights = res[1]
                    
                    if weights:
                        # Collect all vault addresses first
                        all_vault_addresses = [w[0] for w in weights]
                        
                        # Fetch all vault names at once
                        vault_names = self.get_vault_names_from_api(all_vault_addresses)
                        
                        
                        table = Table(show_header=True, header_style="bold magenta")
                        table.add_column("Vault Address", style="cyan")
                        table.add_column("Name", style="green")
                        table.add_column("Percentage", style="yellow")
                        
                        for w in weights:
                            receiver, pct_num = w[0], int(w[1])
                            
                            # Try API lookup first
                            vault_name = vault_names.get(receiver)
                            
                            if vault_name:
                                display_name = f"{vault_name} ({receiver})"
                            else:
                                # Check if it's a known core contract
                                contract_type = contract_types.get(receiver.lower())
                                if contract_type:
                                    display_name = f"{contract_type} ({receiver})"
                                else:
                                    display_name = f"Unknown Vault ({receiver})"
                            table.add_row(receiver, display_name, f"{pct_num/100:.2f}%")
                        
                        console.print(table)
                        console.print(f"[dim]Active since block: {allocation_start_block}[/dim]")
                    else:
                        console.print("[yellow]No active reward allocation found[/yellow]")
                else:
                    console.print("[yellow]No active reward allocation found[/yellow]")
                    
            except Exception as e:
                console.print(f"[red]Error getting reward allocation: {e}[/red]")
            
            # Also show queued allocation if any
            try:
                res = self.berachef.functions.getQueuedRewardAllocation(pubkey_bytes).call()
                if isinstance(res, (list, tuple)) and len(res) == 2:
                    queued_start_block = res[0]
                    queued_weights = res[1]
                    if queued_weights:
                        console.print()
                        console.print("[cyan]📋 Queued Reward Allocation:[/cyan]")
                        
                        # Collect all queued vault addresses
                        queued_vault_addresses = [w[0] for w in queued_weights]
                        
                        # Fetch all queued vault names at once
                        queued_vault_names = self.get_vault_names_from_api(queued_vault_addresses)
                        
                        for w in queued_weights:
                            receiver, pct_num = w[0], int(w[1])
                            vault_name = queued_vault_names.get(receiver)
                            if vault_name:
                                display_name = f"{vault_name} ({receiver})"
                            else:
                                contract_type = contract_types.get(receiver.lower())
                                if contract_type:
                                    display_name = f"{contract_type} ({receiver})"
                                else:
                                    display_name = f"Unknown Vault ({receiver})"
                            console.print(f"  • {display_name}: {pct_num/100:.2f}%")
                        console.print(f"[dim]Will activate at block: {queued_start_block}[/dim]")
            except Exception:
                pass  # No queued allocation
            
        except Exception as e:
            console.print(f"[red]Error viewing vault info: {e}[/red]")

    def manage_roles_action(self):
        """Interactive role management system"""
        try:
            console.print()
            console.print(Panel.fit("🔑 Role Management", style="bold cyan"))
            
            user_address = self.account.address
            console.print(f"[cyan]Managing roles for: {user_address}[/cyan]")
            console.print()
            
            # Define all available roles (excluding DEFAULT_ADMIN_ROLE)
            available_roles = [
                "VALIDATOR_ADMIN_ROLE",
                "BGT_MANAGER_ROLE", 
                "PROTOCOL_FEE_MANAGER_ROLE",
                "REWARDS_ALLOCATION_MANAGER_ROLE",
                "COMMISSION_MANAGER_ROLE",
                "INCENTIVE_COLLECTOR_MANAGER_ROLE"
            ]
            
            # Get current role status
            current_roles = {}
            for role in available_roles:
                try:
                    role_hash = Web3.to_bytes(hexstr=ROLES[role])
                    has_role = self.operator.functions.hasRole(role_hash, user_address).call()
                    current_roles[role] = has_role
                except Exception as e:
                    console.print(f"[red]❌ Error checking {role}: {e}[/red]")
                    current_roles[role] = False
            
            # Show current status
            console.print("[bold]Current Role Status:[/bold]")
            for role in available_roles:
                status = "✓" if current_roles[role] else "✗"
                color = "green" if current_roles[role] else "red"
                console.print(f"  [{color}]{status}[/{color}] {role}")
            
            console.print()
            
            # Interactive role selection
            console.print("[bold]Select roles to toggle:[/bold]")
            console.print("[dim]Press Space to select/deselect, Enter when done[/dim]")
            console.print("[dim]Note: Roles currently ON will be revoked, roles currently OFF will be granted[/dim]")
            choices = []
            for role in available_roles:
                current_status = "ON" if current_roles[role] else "OFF"
                choice_text = f"{role} ({current_status})"
                choices.append(choice_text)
            
            selected_roles = questionary.checkbox(
                "Choose roles to toggle:",
                choices=choices
            ).ask()
            
            if not selected_roles:
                console.print("[yellow]No changes selected.[/yellow]")
                return
            
            # Determine what changes to make
            changes = []
            for choice in selected_roles:
                role = choice.split(" (")[0]  # Remove the (ON/OFF) part
                current_has_role = current_roles[role]
                changes.append((role, not current_has_role))  # Toggle the role
            
            # Show planned changes
            console.print()
            console.print("[bold]Planned Changes:[/bold]")
            for role, should_have in changes:
                action = "Grant" if should_have else "Revoke"
                color = "green" if should_have else "red"
                console.print(f"  [{color}]{action}[/{color}] {role}")
            
            console.print()
            if not questionary.confirm("Apply these changes?", default=True).ask():
                console.print("[yellow]Changes cancelled.[/yellow]")
                return
            
            # Apply changes
            success_count = 0
            for role, should_have in changes:
                try:
                    action = "Granting" if should_have else "Revoking"
                    console.print(f"[cyan]{action} {role}...[/cyan]")
                    
                    if role not in ROLES:
                        console.print(f"[red]❌ Unknown role: {role}[/red]")
                        continue
                    
                    role_hash = Web3.to_bytes(hexstr=ROLES[role])
                    
                    if should_have:
                        tx_data = self.operator.functions.grantRole(
                            role_hash,
                            user_address
                        ).build_transaction({'from': self.account.address})
                        self.execute_or_show_calldata(f"grantRole({role})", tx_data)
                    else:
                        tx_data = self.operator.functions.revokeRole(
                            role_hash,
                            user_address
                        ).build_transaction({'from': self.account.address})
                        self.execute_or_show_calldata(f"revokeRole({role})", tx_data)
                    
                    success_count += 1
                    
                except Exception as e:
                    console.print(f"[red]❌ Failed to modify {role}: {e}[/red]")
            
            console.print()
            if success_count > 0:
                console.print(f"[green]✅ Successfully applied {success_count} change(s)[/green]")
                console.print("[yellow]Note: You may need to refresh the status to see updated roles.[/yellow]")
            else:
                console.print("[red]❌ No changes were applied successfully.[/red]")
                
        except Exception as e:
            console.print(f"[red]Error managing roles: {e}[/red]")


    def build_menu(self) -> List[Tuple[str, str, callable]]:
        """Build menu based on user's roles"""
        menu = [("status", "📊 View Status", self.display_status)]
        
        # BGT Operations (anyone can queue/activate, BGT_MANAGER can drop/redeem)
        menu.append(("queue_boost", "⬆️  Queue Boost (unboosted → boosted)", self.queue_boost_action))
        menu.append(("activate_boost", "✅ Activate Boost", self.activate_boost_action))
        
        if self.roles.get("BGT_MANAGER_ROLE"):
            menu.append(("queue_drop", "⬇️  Queue Drop Boost", self.queue_drop_boost_action))
            menu.append(("drop_boost", "✅ Execute Drop Boost", self.drop_boost_action))
            menu.append(("redeem_bgt", "💰 Redeem BGT for BERA", self.redeem_bgt_action))
        
        # Rewards allocation
        if self.roles.get("REWARDS_ALLOCATION_MANAGER_ROLE"):
            menu.append(("queue_rewards", "📊 Queue Rewards Allocation", self.queue_rewards_allocation_action))
        
        # Commission
        if self.roles.get("COMMISSION_MANAGER_ROLE"):
            menu.append(("register_operator", "🔧 Register as Validator Operator", self.register_as_operator_action))
            menu.append(("queue_commission", "💵 Queue Validator Commission", self.queue_commission_action))
        
        # Claims (anyone can call)
        menu.append(("claim_boost_rewards", "🎁 Claim Boost Rewards (HONEY + Incentives) [Recommended]", self.claim_boost_rewards_action))
        menu.append(("claim_honey", "🍯 Claim BGT Staker Rewards (HONEY only)", self.claim_bgt_staker_reward_action))
        
        # Protocol fee management
        if self.roles.get("PROTOCOL_FEE_MANAGER_ROLE"):
            menu.append(("set_fee", "💸 Set Protocol Fee Percentage", self.set_protocol_fee_action))
            menu.append(("accrue_fees", "📈 Accrue Earned BGT Fees", self.accrue_fees_action))
        
        # Role management (available to anyone; contract enforces permissions)
        menu.append(("manage_roles", "🔑 Manage Roles", self.manage_roles_action))

        return menu

    def run(self):
        """Main interactive loop"""
        self.connect()
        
        while True:
            console.print()
            menu_items = self.build_menu()
            
            choices = [item[1] for item in menu_items] + ["🚪 Exit"]
            
            choice = questionary.select(
                "What would you like to do?",
                choices=choices
            ).ask()
            
            if choice == "🚪 Exit" or choice is None:
                console.print("[cyan]Goodbye! 🐻[/cyan]")
                break
            
            # Find and execute the action
            for key, label, action in menu_items:
                if label == choice:
                    try:
                        action()
                    except Exception as e:
                        console.print(f"[red]Error: {e}[/red]")
                    break


def main():
    import argparse
    parser = argparse.ArgumentParser(description="SmartOperator Manager - Interactive validator operations tool")
    parser.add_argument("--show-calldata", action="store_true", help="Show calldata instead of executing transactions")
    args = parser.parse_args()
    
    try:
        manager = SmartOperatorManager(show_calldata=args.show_calldata)
        manager.run()
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted by user[/yellow]")
        sys.exit(0)
    except Exception as e:
        console.print(f"\n[red]Fatal error: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    main()


