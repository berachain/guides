FROM ubuntu:24.04

# Install dependencies
RUN apt-get update && apt-get install -y curl wget;

# Download and install reth
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        ARCH="aarch64"; \
    else \
        ARCH="x86_64"; \
    fi && \
    if [ "$TARGETOS" = "darwin" ]; then \
        OS="apple-darwin"; \
    else \
        OS="unknown-linux-gnu"; \
    fi && \
    echo "Using architecture: $ARCH, OS: $OS" && \
    echo "Fetching latest release info..." && \
    curl -s https://api.github.com/repos/paradigmxyz/reth/releases/latest > release_info.json && \
    RETH_RELEASE_URL=$(grep '"browser_download_url":' release_info.json | \
        sed 's/.*"browser_download_url": "\(.*\)".*/\1/' | \
        grep "reth-.*-${ARCH}-${OS}.tar.gz" | \
        grep -v "op-reth" | \
        grep -v "\.asc$") && \
    echo "Downloading Reth from: $RETH_RELEASE_URL" && \
    wget $RETH_RELEASE_URL && \
    tar -xzvf reth-*.tar.gz && \
    chmod +x reth && \
    rm reth-*.tar.gz && \
    ./reth --version

