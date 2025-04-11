FROM ubuntu:24.04                       

ARG CHAIN_SPEC
ENV CHAIN_SPEC=${CHAIN_SPEC}

# Check if the architecture is supported
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" != "aarch64" ]; then \
        echo "This image only supports aarch64 (got $ARCH)"; \
        exit 1; \
    fi

# Install dependencies
RUN apt-get update && apt-get install -y curl wget;

# Download and install beacon-kit
RUN BEACOND_RELEASE_URL=$(curl -s https://api.github.com/repos/berachain/beacon-kit/releases/latest | grep '"browser_download_url":' | sed 's/.*"browser_download_url": "\(.*\)".*/\1/' | grep "linux-arm64" | grep -v "\.sig$"); \
    wget $BEACOND_RELEASE_URL; \
    tar -xzvf beacond-*.tar.gz; \
    mv beacond-v*-linux-*64 beacond; \
    chmod +x beacond;