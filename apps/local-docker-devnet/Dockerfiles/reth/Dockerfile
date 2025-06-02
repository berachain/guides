FROM ubuntu:24.04

# Declare build arguments
ARG TARGETARCH
ARG TARGETOS

# Install dependencies
RUN apt-get update && apt-get install -y curl wget;

# Debug output
RUN echo "TARGETARCH: $TARGETARCH" && echo "TARGETOS: $TARGETOS"

# Download and install reth
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        ARCH="aarch64"; \
    else \
        ARCH="x86_64"; \
    fi && \
    OS="unknown-linux-gnu" && \
    echo "Using architecture: $ARCH, OS: $OS" && \
    echo "Fetching latest release info..." && \
    curl -s https://api.github.com/repos/paradigmxyz/reth/releases/latest > release_info.json && \
    echo "Available binaries:" && \
    grep '"browser_download_url":' release_info.json | \
        sed 's/.*"browser_download_url": "\(.*\)".*/\1/' | \
        grep "reth-.*-${ARCH}-${OS}.tar.gz" | \
        grep -v "op-reth" | \
        grep -v "\.asc$" > selected_binary.txt && \
    echo "Selected binary:" && \
    cat selected_binary.txt && \
    RETH_RELEASE_URL=$(cat selected_binary.txt) && \
    echo "Downloading Reth from: $RETH_RELEASE_URL" && \
    wget $RETH_RELEASE_URL && \
    tar -xzvf reth-*.tar.gz && \
    chmod +x reth && \
    rm reth-*.tar.gz && \
    ./reth --version

