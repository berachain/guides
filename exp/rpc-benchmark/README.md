# Berachain RPC Throughput Tester

A comprehensive RPC testing tool for benchmarking Berachain node performance, including support for archive node testing with historical queries.

## Features

- **Diverse RPC Call Testing**: Tests multiple contract methods and standard JSON-RPC calls
- **Archive Node Support**: Random historical block queries to test archive functionality
- **Concurrent Load Testing**: Configurable concurrent request patterns
- **Detailed Metrics**: Latency, throughput, success rates, and error analysis
- **Circuit Breaker**: Prevents overwhelming failing nodes
- **Read-Only Operations**: All calls are safe `eth_call` queries that don't modify state

## Contract Methods Tested (22 Total)

| Call Name | Contract | Address | Function | Description |
|-----------|----------|---------|----------|-------------|
| `bgt_totalSupply` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `totalSupply()` | Returns total BGT supply |
| `bgt_balanceOf_zero` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `balanceOf(0x0)` | BGT balance of zero address |
| `bgt_balanceOf_validator1` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `balanceOf(governance)` | BGT balance of governance address |
| `bgt_balanceOf_validator2` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `balanceOf(berachef)` | BGT balance of BeraChef address |
| `bgt_balanceOf_vault` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `balanceOf(vault)` | BGT balance of BEX Vault |
| `bgt_balanceOf_honey` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `balanceOf(honey)` | BGT balance of HONEY contract |
| `bgt_balanceOf_wbera` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `balanceOf(wbera)` | BGT balance of WBERA contract |
| `bgt_minter` | BGT Token | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` | `minter()` | Returns the authorized minter address |
| `honey_totalSupply` | HONEY Token | `0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce` | `totalSupply()` | Returns total HONEY supply |
| `honey_name` | HONEY Token | `0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce` | `name()` | Returns token name |
| `honey_symbol` | HONEY Token | `0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce` | `symbol()` | Returns token symbol |
| `honey_decimals` | HONEY Token | `0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce` | `decimals()` | Returns token decimals |
| `wbera_totalSupply` | WBERA Token | `0x6969696969696969696969696969696969696969` | `totalSupply()` | Returns total WBERA supply |
| `wbera_name` | WBERA Token | `0x6969696969696969696969696969696969696969` | `name()` | Returns token name |
| `wbera_decimals` | WBERA Token | `0x6969696969696969696969696969696969696969` | `decimals()` | Returns token decimals |
| `vault_getAuthorizer` | BEX Vault | `0x4Be03f781C497A489E3cB0287833452cA9b9E80B` | `getAuthorizer()` | Returns the vault's authorizer contract |
| `vault_getProtocolFeesCollector` | BEX Vault | `0x4Be03f781C497A489E3cB0287833452cA9b9E80B` | `getProtocolFeesCollector()` | Returns protocol fees collector address |
| `gov_votingDelay` | Governance | `0x4f4A5c2194B8e856b7a05B348F6ba3978FB6f6D5` | `votingDelay()` | Returns voting delay period |
| `gov_votingPeriod` | Governance | `0x4f4A5c2194B8e856b7a05B348F6ba3978FB6f6D5` | `votingPeriod()` | Returns voting period length |
| `eth_blockNumber` | JSON-RPC | N/A | `eth_blockNumber` | Latest block number |
| `eth_gasPrice` | JSON-RPC | N/A | `eth_gasPrice` | Current gas price |
| `net_version` | JSON-RPC | N/A | `net_version` | Network version ID |

### Key Features of the Test Suite:
- **Diverse BGT Balance Queries**: Tests BGT token balances across 6 different important contract addresses
- **Token Metadata Calls**: Validates name, symbol, decimals, and supply functions across ERC20 tokens
- **Governance Functions**: Tests core governance contract view functions
- **Exchange Infrastructure**: Tests BEX vault authorization and fee collection functions
- **Standard RPC Calls**: Includes basic JSON-RPC methods for baseline comparison

## Installation

```bash
# Install dependencies
pip install aiohttp

# Make executable
chmod +x berachain-rpc-tester.py
```

## Usage

### Basic Testing

Test default mainnet RPC for 60 seconds:
```bash
python berachain-rpc-tester.py
```

### Custom Configuration

Test specific RPC with custom settings:
```bash
python berachain-rpc-tester.py \
  --rpc-url https://rpc.berachain.com/ \
  --duration 120 \
  --concurrent 100
```

### Archive Node Testing

Test archive node capabilities with historical queries:
```bash
python berachain-rpc-tester.py \
  --archive \
  --archive-blocks 3000000 \
  --duration 180
```

### Quick Test

Run a quick 10-second test:
```bash
python berachain-rpc-tester.py --duration 10
```

## Command Line Options

- `--rpc-url URL`: Berachain RPC endpoint (default: https://rpc.berachain.com/)
- `--duration SECONDS`: Test duration (default: 60)
- `--concurrent NUMBER`: Max concurrent requests (default: 50)
- `--archive`: Enable archive node testing with historical queries
- `--archive-blocks NUMBER`: Blocks back to test for archive (default: 3,000,000)
- `--verbose`: Enable verbose logging

## Output Metrics

The tool provides comprehensive statistics including:

### Overall Statistics
- Total RPC calls made
- Success/failure counts and rates
- Overall and success-only throughput (calls/second)

### Latency Analysis
- Average, median, min, max latency
- Standard deviation
- 95th and 99th percentile latencies

### Call Type Breakdown
- Success rate per contract/method
- Individual call type performance

### Archive Node Metrics (when enabled)
- Historical vs current call performance
- Archive-specific latency statistics
- Success rates for historical queries

### Error Analysis
- Detailed breakdown of error types
- Error frequency and percentages

## Example Output

```
================================================================================
BERACHAIN RPC THROUGHPUT TEST RESULTS
================================================================================

OVERALL STATISTICS:
Total RPC calls:      12,847
Successful calls:     12,234
Failed calls:         613
Success rate:         95.23%
Total test time:      60.12 seconds
Overall throughput:   213.76 calls/second
Success throughput:   203.54 calls/second

LATENCY STATISTICS (successful calls only):
Average latency:      89.45 ms
Median latency:       67.23 ms
Min latency:          23.45 ms
Max latency:          2,345.67 ms
Std deviation:        78.90 ms
95th percentile:      234.56 ms
99th percentile:      567.89 ms

CALL TYPE BREAKDOWN:
Call Type                 Total    Success  Rate    
--------------------------------------------------
bgt_totalSupply          1,247    1,234    98.9%
honey_totalSupply        1,198    1,156    96.5%
vault_getAuthorizer      1,089    1,067    98.0%
...

ARCHIVE NODE STATISTICS:
Historical calls:     3,654
Historical success:   3,521
Historical success rate: 96.36%
Historical avg latency: 145.67 ms
Historical median latency: 123.45 ms
Current calls success rate: 94.78%

ERROR BREAKDOWN:
Timeout                       345 ( 56.3%)
Connection refused            156 ( 25.4%)
Invalid method                 89 ( 14.5%)
Circuit breaker open           23 (  3.8%)
```

## Safety Notes

- All operations are read-only queries using `eth_call`
- No transactions are created or state modifications made
- Safe to run against production nodes
- Circuit breaker prevents overwhelming failing nodes
- Respects node resources with configurable concurrency limits

## Development

The script uses:
- `asyncio` and `aiohttp` for async HTTP requests
- Circuit breaker pattern for fault tolerance
- Structured logging for debugging
- Comprehensive error handling and statistics tracking
