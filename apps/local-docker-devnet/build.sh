#!/bin/bash

set -e;
source env.sh;

docker build -t $DOCKER_IMAGE_BEACOND -f ./Dockerfiles/beacond/Dockerfile --build-arg CHAIN_SPEC=$CHAIN_SPEC .;
docker build -t $DOCKER_IMAGE_RETH -f ./Dockerfiles/reth/Dockerfile .;
docker build -t $DOCKER_IMAGE_CURL -f ./Dockerfiles/curl/Dockerfile .;

echo "*** Build complete";
