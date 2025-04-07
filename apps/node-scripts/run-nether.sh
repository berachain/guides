#!/bin/bash

set -e
. ./env.sh

$NETHERMIND_BIN  --config $NETHERMIND_CONFIG_DIR/nethermind.cfg 
