# Peer Filter

A Go application for connecting to geth/reth IPC endpoints and managing peer connections with filtering capabilities.

## Building

### Prerequisites

- **Binary option**: Use pre-built binaries from the `dist/` directory for your platform
- **Build option**: Go 1.21 or later installed on your system to compile from source
- Node (bera-reth or bera-geth) must be configured with the `--ipcfilter <filepath>` option to enable the IPC endpoint. This endpoint allows sending administrative commands without exposing them over JSON-RPC, providing a secure way to manage peer connections and perform other administrative tasks.

### Compile Instructions

```bash
go mod tidy
go build -o peer-filter peer-filter.go
```

## Usage

```bash
./peer-filter [command] [ipc-path]
IPC_SOCKET=/path/to/socket.ipc ./peer-filter [command]
```

## Commands

- `info` (default) - Show client version, block number, and peer count
- `peer-summary` - Show peer statistics and client breakdown
- `peer-list` - Show full enode and client details for all peers
- `peer-purge-dry-run` - Show how many peers would be removed by filter
- `peer-purge` - Remove unwanted peers based on whitelist filter

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
