#!/bin/bash

set -e;
source env.sh;

# Detect architecture and OS
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
    DOCKER_PLATFORM="linux/arm64"
else
    DOCKER_PLATFORM="linux/amd64"
fi

echo "Debug: Architecture: $ARCH"
echo "Debug: OS: $OS"
echo "Debug: Docker Platform: $DOCKER_PLATFORM"
echo "Debug: DOCKER_IMAGE_RETH: $DOCKER_IMAGE_RETH"
echo "Debug: DOCKER_IMAGE_BEACOND: $DOCKER_IMAGE_BEACOND"
echo "Debug: DOCKER_IMAGE_CURL: $DOCKER_IMAGE_CURL"
echo "Debug: CHAIN_SPEC: $CHAIN_SPEC"
echo "Debug: CUSTOM_BIN_BEACOND: $CUSTOM_BIN_BEACOND"

echo "Building for platform: $DOCKER_PLATFORM, OS: $OS"

echo "*** Building reth";
docker build --progress=plain  --platform $DOCKER_PLATFORM -t $DOCKER_IMAGE_RETH \
    -f ./Dockerfiles/reth/Dockerfile \
    --build-arg TARGETOS=$OS \
    . || { echo "Failed to build reth"; exit 1; }

# do custom build if CUSTOM_BIN_BEACOND is set and not empty
if [ -f "$CUSTOM_BIN_BEACOND" ]; then
    docker build --progress=plain  --platform $DOCKER_PLATFORM -t $DOCKER_IMAGE_BEACOND \
        -f ./Dockerfiles/beacond/Dockerfile-custombuild \
        --build-arg CHAIN_SPEC=$CHAIN_SPEC \
        --build-arg CUSTOM_BIN_BEACOND=$CUSTOM_BIN_BEACOND \
        --build-arg TARGETOS=$OS \
        --build-arg TARGETARCH=$ARCH \
        .
else
    docker build --progress=plain  --platform $DOCKER_PLATFORM -t $DOCKER_IMAGE_BEACOND \
        -f ./Dockerfiles/beacond/Dockerfile-officialbuild \
        --build-arg CHAIN_SPEC=$CHAIN_SPEC \
        --build-arg TARGETOS=$OS \
        --build-arg TARGETARCH=$ARCH \
        .
fi

echo "*** Building curl";
docker build --progress=plain --platform $DOCKER_PLATFORM -t $DOCKER_IMAGE_CURL \
    -f ./Dockerfiles/curl/Dockerfile \
    --build-arg TARGETOS=$OS \
    . || { echo "Failed to build curl"; exit 1; }

echo "*** Build complete";
