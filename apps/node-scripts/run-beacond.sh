#!/bin/bash

set -e
. ./env.sh

$BEACOND_BIN start --home $BEACOND_DATA
