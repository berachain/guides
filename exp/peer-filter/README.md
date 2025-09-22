# IPC Peer Filter Tool

Standalone Node.js script for live peer management via IPC connection to geth/reth nodes.

## Usage

### Node.js Script
```bash
node ipc-client.js [command] [ipc-path]
# or
IPC_SOCKET=/path/to/socket.ipc node ipc-client.js [command]
```

### Standalone Executable
```bash
# Build first
npm install
npm run build

# Then run
./dist/ipc-peer-filter [command] [ipc-path]
# or
IPC_SOCKET=/path/to/socket.ipc ./dist/ipc-peer-filter [command]
```

## Commands

- `info` (default) - Client version, block number, peer count
- `peer-summary` - Peer statistics with tables
- `peer-list` - Full enode details for all peers
- `peer-purge-dry-run` - Preview what would be removed
- `peer-purge` - Remove unwanted peers

## Whitelist

Keeps only these clients:
- BeraGeth, BeraReth, bera-reth
- reth/v1.6.0-48941e6, reth/v1.7.0-9d56da5

⚠️ **Always run `peer-purge-dry-run` first** to see what would be removed!

## Requirements

- **Development**: Node.js >= 14.0.0
- **Runtime**: None (standalone executable)
