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

## Examples

```bash
# Basic info
node ipc-client.js /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc

# Peer summary
./dist/ipc-peer-filter peer-summary /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc

# Check what would be removed (safe)
./dist/ipc-peer-filter peer-purge-dry-run /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc

# Actually remove unwanted peers
./dist/ipc-peer-filter peer-purge /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc

# Use environment variable
export IPC_SOCKET=/storage/berabox/installations/bb-mainnet-reth/runtime/ipc/reth.ipc
./dist/ipc-peer-filter peer-summary
```

## Build Options

```bash
# Install dependencies
npm install

# Build for current platform (Linux x64)
npm run build

# Build for Linux + macOS
npm run build-all

# Build Linux only
npm run build-linux
```

## Whitelist

Keeps only these clients:
- BeraGeth, BeraReth, bera-reth
- reth/v1.6.0-48941e6, reth/v1.7.0-9d56da5

⚠️ **Always run `peer-purge-dry-run` first** to see what would be removed!

## Requirements

- **Development**: Node.js >= 14.0.0
- **Runtime**: None (standalone executable)