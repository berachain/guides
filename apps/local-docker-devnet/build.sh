#!/bin/bash

set -e;
source env.sh;

# do custom build if CUSTOM_BIN_BEACOND is set and not empty
if [ -f "$CUSTOM_BIN_BEACOND" ]; then
    echo "*** Building beacond w/custom build";
    docker build --quiet -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile-custombuild --build-arg CHAIN_SPEC=$CHAIN_SPEC --build-arg CUSTOM_BIN_BEACOND=$CUSTOM_BIN_BEACOND .;
else
    echo "*** Building beacond w/official build";
    docker build --quiet -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile-officialbuild --build-arg CHAIN_SPEC=$CHAIN_SPEC .;
fi

echo "*** Building reth";
docker build --quiet -t $DOCKER_IMAGE_RETH -f ./Dockerfiles/reth/Dockerfile .;

echo "*** Building curl";
docker build --quiet -t $DOCKER_IMAGE_CURL -f ./Dockerfiles/curl/Dockerfile .;

echo "*** Build complete";
