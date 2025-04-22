#!/bin/bash

set -e;
source env.sh;

# do custom build if CUSTOM_BIN_BEACOND is set and not empty
if [ -f "$CUSTOM_BIN_BEACOND" ]; then
    docker build -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile-custombuild --build-arg CHAIN_SPEC=$CHAIN_SPEC --build-arg CUSTOM_BIN_BEACOND=$CUSTOM_BIN_BEACOND .;
else
    docker build -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile-officialbuild --build-arg CHAIN_SPEC=$CHAIN_SPEC .;
fi

docker build -t $DOCKER_IMAGE_RETH -f ./Dockerfiles/reth/Dockerfile .;
docker build -t $DOCKER_IMAGE_CURL -f ./Dockerfiles/curl/Dockerfile .;

echo "*** Build complete";
