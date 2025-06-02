FROM ubuntu:24.04

# Check if the architecture is supported
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" != "aarch64" ]; then \
        echo "This image only supports aarch64 (got $ARCH)"; \
        exit 1; \
    fi

# Install dependencies
RUN apt-get update && apt-get install -y curl wget;

# Download and install beacon-kit
RUN RETH_RELEASE_URL=$(curl -s https://api.github.com/repos/paradigmxyz/reth/releases/latest | grep '"browser_download_url":' | sed 's/.*"browser_download_url": "\(.*\)".*/\1/' | grep "aarch64-unknown-linux-gnu.tar.gz" | grep -v "\.asc$" | grep -v "op-reth"); \
    wget $RETH_RELEASE_URL; \
    tar -xzvf reth-*.tar.gz; \
    chmod +x reth;