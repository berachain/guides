# Peer Filter Tool

A Node.js utility for analyzing and filtering Ethereum peer connections from JSON-RPC peer logs.

## Features

- **List Mode**: Identify all client types in a peer log
- **Clean Mode**: Generate `admin.removePeer()` commands to remove non-whitelisted clients

## Installation

```bash
cd peer-filter
npm install
```

## Usage

### Command Line Options

```bash
node peer-filter.js <mode> [input]
```

**Modes:**
- `list` - List all client types found in the peer log
- `clean` - Generate `admin.removePeer()` commands for non-whitelisted clients

**Input Options:**
- `<file>` - Read peer data from specified file
- `--` - Read peer data from stdin (standard input)
- `(none)` - Read peer data from stdin (if no input specified)

**Help:**
- `--help` or `-h` - Show detailed help information

### Examples

#### List All Clients

```bash
# Read from file
node peer-filter.js list seed-reth-1-peers.log

# Read from stdin using pipe
cat seed-reth-1-peers.log | node peer-filter.js list

# Read from stdin using redirection
node peer-filter.js list < seed-reth-1-peers.log

# Read from stdin with explicit --
cat seed-reth-1-peers.log | node peer-filter.js list --
```

This will show:
- All client types found in the peer log
- Count of peers per client type
- Example peer details for each client type
- Total statistics

#### Clean Non-Whitelisted Clients

```bash
# Read from file
node peer-filter.js clean seed-reth-1-peers.log

# Read from stdin using pipe
cat seed-reth-1-peers.log | node peer-filter.js clean

# Read from stdin using redirection
node peer-filter.js clean -- < seed-reth-1-peers.log

# Read from stdin with explicit --
cat seed-reth-1-peers.log | node peer-filter.js clean --
```

This will:
- Show statistics about whitelisted vs non-whitelisted clients
- Generate `admin.removePeer()` commands for non-whitelisted peers
- Display the commands one per line for easy copy-paste

## Whitelisted Clients

The following clients are currently whitelisted (can be modified in the script):

- `BeraGeth` - Berachain's custom Geth client
- `Geth` - Standard Ethereum Geth client
- `reth` - Reth client
- `bera1` - Custom client name

## Input Format

The script expects a JSON file with the following structure:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    {
      "enode": "enode://...",
      "id": "...",
      "name": "ClientName/version/platform",
      "caps": [...],
      "network": {...},
      "protocols": {...}
    }
  ]
}
```

## Example Output

### List Mode
```
=== All Clients Found ===

Geth: 45 peers
  Examples:
    1. Geth/v1.14.13-stable-eb00f169/linux-amd64/go1.23.2
       enode://739e6fc82099998e09f587db6433a8a9ff379e0725aed516de5cd2cf103b3c46cc95e3431d2114b39639d50aeab6af03728fa6230edd0fcaca4a26556913bcbc@51.68.178.240:30303
    ... and 42 more

BeraGeth: 12 peers
  Examples:
    1. BeraGeth/v1.011602.3/linux-amd64/go1.24.6
       enode://ce34a16fd072808740ccb602ebf32c786bb83a5b044a0d2d19c1988abfba1f2757e200f0f5244a632f5d71050d898d10a9e260322352dc4fc6e639cc23fe445f@34.47.95.52:30303
    ... and 9 more

Total peers: 57
Unique clients: 2
```

### Clean Mode
```
=== Cleaning Non-Whitelisted Clients ===

Whitelisted clients: BeraGeth, Geth, reth, bera1

Client Statistics:
  Geth: 45 total, 45 whitelisted, 0 to remove [✓ WHITELISTED]
  BeraGeth: 12 total, 12 whitelisted, 0 to remove [✓ WHITELISTED]

Total peers to remove: 0
Total peers to keep: 57

No peers need to be removed - all clients are whitelisted!
```

## Customization

To modify the whitelist, edit the `ALLOWED_CLIENTS` array in `peer-filter.js`:

```javascript
const ALLOWED_CLIENTS = [
    'BeraGeth',
    'Geth',
    'reth',
    'bera1',
    'YourCustomClient'  // Add your client here
];
```
