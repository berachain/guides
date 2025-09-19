# Peer Filter Tool

A Node.js utility for analyzing and filtering Ethereum peer connections from JSON-RPC peer logs.

## Features

- **Summary Mode**: Show client statistics and keep/remove recommendations
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
- `summary` - Show client statistics and keep/remove recommendations
- `clean` - Generate `admin.removePeer()` commands for non-whitelisted clients

**Input Options:**
- `<file>` - Read peer data from specified file
- `(none)` - Read peer data from stdin 

**Help:**
- `--help` or `-h` - Show detailed help information

### Examples

#### Show Client Summary

```bash
# Read from file
node peer-filter.js summary seed-reth-1-peers.log

# Read from stdin using redirection
node peer-filter.js summary < seed-reth-1-peers.log
```

This will show:
- All client types found in the peer log
- Count of peers per client type
- Keep/remove status for each client type
- Summary statistics with percentages

#### Clean Non-Whitelisted Clients

```bash
# Read from file
node peer-filter.js clean seed-reth-1-peers.log

# Read from stdin using redirection
node peer-filter.js clean -- < seed-reth-1-peers.log
```

This will:
- Generate `admin.removePeer()` commands for non-whitelisted peers

## Whitelisted Clients

Review `peer-filter.js` and adjust the list of whitelisted clients.

- `BeraGeth` - Berachain's custom Geth client
- `BeraReth`/`bera-reth` - Berachain's custom Reth client
- `reth/v1.6.0-48941e6` - Specific Reth version
- `reth/v1.7.0-9d56da5` - Specific Reth version

## Input Format

The script expects a JSON file with the structure of "admin.peers" output from an reth/geth node.

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

### Summary Mode
```
=== Peer Summary ===

Found Clients:
  Geth: 45 peers [✗ REMOVE]
  BeraGeth: 12 peers [✓ KEEP]

Summary:
  Total peers: 57
  To keep: 12 (21.1%)
  To remove: 45 (78.9%)
  Unique clients: 2
```

### Clean Mode
```
admin.removePeer("enode://739e6fc82099998e09f587db6433a8a9ff379e0725aed516de5cd2cf103b3c46cc95e3431d2114b39639d50aeab6af03728fa6230edd0fcaca4a26556913bcbc@51.68.178.240:30303");
admin.removePeer("enode://...");
```

