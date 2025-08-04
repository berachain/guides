#!/bin/bash

set -e;
source env.sh;

# Copy custom binaries from /tmp/ to local directory for Docker build context
if [ -f "$CUSTOM_BIN_BEACOND" ]; then
    echo "*** Copying custom beacond binary to local directory";
    cp "$CUSTOM_BIN_BEACOND" ./beacond-custom;
    CUSTOM_BIN_BEACOND=./beacond-custom;
fi

if [ -f "$CUSTOM_BIN_RETH" ]; then
    echo "*** Copying custom reth binary to local directory";
    cp "$CUSTOM_BIN_RETH" ./reth-custom;
    CUSTOM_BIN_RETH=./reth-custom;
fi

# do custom build if CUSTOM_BIN_BEACOND is set and not empty
if [ -f "$CUSTOM_BIN_BEACOND" ]; then
    echo "*** Building beacond w/custom build";
    docker build --quiet -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile-custombuild --build-arg CHAIN_SPEC=$CHAIN_SPEC --build-arg CUSTOM_BIN_BEACOND=$CUSTOM_BIN_BEACOND .;
else
    echo "*** Building beacond w/official build";
    docker build --quiet -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile-officialbuild --build-arg CHAIN_SPEC=$CHAIN_SPEC .;
fi

# do custom build if CUSTOM_BIN_RETH is set and not empty
if [ -f "$CUSTOM_BIN_RETH" ]; then
    echo "*** Building reth w/custom build";
    docker build --quiet -t $DOCKER_IMAGE_RETH -f ./Dockerfiles/reth/Dockerfile-custombuild --build-arg CUSTOM_BIN_RETH=$CUSTOM_BIN_RETH .;
else
    echo "*** Building reth w/official build";
    docker build --quiet -t $DOCKER_IMAGE_RETH -f ./Dockerfiles/reth/Dockerfile-officialbuild .;
fi

echo "*** Building curl";
docker build --quiet -t $DOCKER_IMAGE_CURL -f ./Dockerfiles/curl/Dockerfile .;

echo "*** Extracting version information";

# Test beacond execution
echo -n "beacond: ";
if docker run --rm $DOCKER_IMAGE_BEACOND beacond version >/dev/null 2>&1; then
    BEACOND_VERSION=$(docker run --rm $DOCKER_IMAGE_BEACOND beacond version 2>/dev/null);
    echo "✓ working (version: ${BEACOND_VERSION:-unknown})";
else
    echo "✗ EXECUTION FAILED";
fi

# Test reth execution
echo -n "reth: ";
if docker run --rm $DOCKER_IMAGE_RETH reth --version >/dev/null 2>&1; then
    RETH_VERSION=$(docker run --rm $DOCKER_IMAGE_RETH reth --version 2>/dev/null | head -1);
    echo "✓ working (version: ${RETH_VERSION:-unknown})";
elif docker run --rm $DOCKER_IMAGE_RETH reth version >/dev/null 2>&1; then
    RETH_VERSION=$(docker run --rm $DOCKER_IMAGE_RETH reth version 2>/dev/null | head -1);
    echo "✓ working (version: ${RETH_VERSION:-unknown})";
else
    echo "✗ EXECUTION FAILED";
fi

echo "*** Build complete";
