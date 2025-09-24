# Peer Filter

A Go application for connecting to geth/reth IPC endpoints and managing peer connections with filtering capabilities.

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
   go build -o peer-filter peer-filter.go
   ```

3. **Make executable (if needed):**
   ```bash
   chmod +x peer-filter
   ```

### Cross-Platform Compilation

To compile for different platforms:

```bash
# Linux x86_64
GOOS=linux GOARCH=amd64 go build -o peer-filter-linux-amd64 peer-filter.go

# Linux ARM64
GOOS=linux GOARCH=arm64 go build -o peer-filter-linux-arm64 peer-filter.go
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
