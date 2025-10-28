# Enode Tester

A comprehensive tool for testing Ethereum enodes to verify their connectivity, node ID validity, and RLPx handshake capabilities.

## Features

- **Connectivity Testing**: Tests basic TCP connectivity to each enode
- **Node ID Validation**: Verifies that the node ID matches the public key in the enode URL
- **Node ID Ownership**: Verifies that the connected node actually owns the private key corresponding to the public key
- **RLPx Handshake**: Performs full RLPx handshake to test protocol compatibility
- **Concurrent Testing**: Tests multiple enodes simultaneously for efficiency
- **Detailed Reporting**: Provides comprehensive results with error details
- **Summary Statistics**: Shows overall success rates and failed enodes

## Installation

```bash
cd enode-tester
go mod tidy
go build -o enode-tester main.go
```

## Usage

### Test enodes from a file:

```bash
./enode-tester enode-list.txt
```

### Test with the included enode list:

```bash
./test-enodes.sh
```

### Test a single enode:

```bash
./enode-tester "enode://089782dab36fddcb9decf27c51bef7ef1980490e6f830718eb918236efb553d7de95302fa4fc87aae6623b7f6087697b5eb5e943039c43d7f6417d8aaee2b0e9@5.9.112.59:30303"
```

## Input Format

The tool expects enode URLs in the standard format:

```
enode://<node-id>@<ip>:<port>
```

For file input, one enode per line, empty lines are ignored.

## Output

The tool provides:

- Real-time status for each enode being tested
- Detailed error messages for failed connections
- Node information (name, version, capabilities) for successful handshakes
- Summary statistics showing overall success rates
- List of all failed enodes with error details

## Test Results

Each enode is tested for:

1. **Reachability**: Can we establish a TCP connection?
2. **Valid Node ID**: Does the node ID match the public key?
3. **Owns Node ID**: Does the connected node actually own the private key?
4. **Handshake OK**: Can we complete the RLPx handshake?

Status indicators:

- ✅ **PASS**: All tests passed
- ⚠️ **PARTIAL**: Reachable with valid ID and ownership but handshake failed
- ❌ **FAIL**: One or more tests failed

## Configuration

The tool uses these default settings:

- Timeout: 10 seconds per connection
- Concurrent connections: 5
- RLPx handshake timeout: 10 seconds

These can be modified in the source code if needed.

## Dependencies

- Go 1.21+
- go-ethereum library for p2p networking
