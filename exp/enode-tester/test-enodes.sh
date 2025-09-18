#!/bin/bash

# Enode Tester Script
# Usage: ./test-enodes.sh [enode-file]

set -e

# Default enode file if none provided
ENODE_FILE="${1:-enode-list.txt}"

# Check if enode file exists
if [ ! -f "$ENODE_FILE" ]; then
    echo "Error: Enode file '$ENODE_FILE' not found"
    echo "Usage: $0 [enode-file]"
    exit 1
fi

# Build the tool if it doesn't exist
    echo "Building enode-tester..."
    go mod tidy
    go build -o enode-tester main.go

# Run the tests
echo "Testing enodes from: $ENODE_FILE"
echo "=================================="
./enode-tester "$ENODE_FILE"
