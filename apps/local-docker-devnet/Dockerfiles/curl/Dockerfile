FROM ubuntu:24.04                   

# Check if the architecture is supported
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" != "aarch64" ]; then \
        echo "This image only supports aarch64 (got $ARCH)"; \
        exit 1; \
    fi

# Install dependencies
RUN apt-get update && apt-get install -y curl wget jq;