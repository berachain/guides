# IPC Client

A Go application for connecting to geth/reth IPC endpoints and managing peer connections.

## Building

### Prerequisites
- Go 1.21 or later installed on your system

### Compile Instructions

1. **Download dependencies:**
   ```bash
   go mod tidy
   ```

2. **Build the binary:**
   ```bash
   go build -o ipc-client ipc-client.go
   ```

3. **Make executable (if needed):**
   ```bash
   chmod +x ipc-client
   ```

### Cross-Platform Compilation

To compile for different platforms:

```bash
# Linux (64-bit)
GOOS=linux GOARCH=amd64 go build -o ipc-client-linux ipc-client.go

# macOS (64-bit)
GOOS=darwin GOARCH=amd64 go build -o ipc-client-macos ipc-client.go

# Windows (64-bit)
GOOS=windows GOARCH=amd64 go build -o ipc-client-windows.exe ipc-client.go

# ARM64 (e.g., Apple Silicon, ARM servers)
GOOS=linux GOARCH=arm64 go build -o ipc-client-arm64 ipc-client.go
```

## Usage

```bash
./ipc-client [command] [ipc-path]
IPC_SOCKET=/path/to/socket.ipc ./ipc-client [command]
```

## Commands

- `info` (default) - Show client version, block number, and peer count
- `peer-summary` - Show peer statistics and client breakdown
- `peer-list` - Show full enode and client details for all peers
- `peer-purge-dry-run` - Show how many peers would be removed by filter
- `peer-purge` - Remove unwanted peers based on whitelist filter

## Examples

```bash
./ipc-client /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc
./ipc-client peer-summary /storage/berabox/installations/bb-testnet-geth/runtime/ipc/geth.ipc
IPC_SOCKET=/storage/berabox/installations/bb-mainnet-reth/runtime/ipc/reth.ipc ./ipc-client peer-purge-dry-run
```

## Features

- Statically compiled binary (no runtime dependencies)
- Concurrent JSON-RPC request handling for better performance
- Unix socket IPC communication
- Peer filtering based on whitelisted client names
- Formatted output with tables and statistics
- Robust error handling and timeouts
- Cross-platform support
- Efficient memory usage

## Dependencies

- Go 1.21+
- No external runtime dependencies (statically linked binary)