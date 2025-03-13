#!/bin/bash

set -e
. ./env.sh

PEERS_OPTION=${EL_PEERS:+--trusted-peers $EL_PEERS}
BOOTNODES_OPTION=${EL_BOOTNODES:+--bootnodes $EL_BOOTNODES}
ARCHIVE_OPTION=$([ "$EL_ARCHIVE_NODE" = true ] && echo "" || echo "--full")
IP_OPTION=${MY_IP:+--nat extip:$MY_IP}

$RETH_BIN node 					\
	--datadir $RETH_DATA			\
	--chain $RETH_GENESIS_PATH		\
	$ARCHIVE_OPTION				\
        $BOOTNODES_OPTION			\
	$PEERS_OPTION				\
	$IP_OPTION				\
	--authrpc.addr 127.0.0.1		\
	--authrpc.port $EL_AUTHRPC_PORT		\
	--authrpc.jwtsecret $JWT_PATH		\
	--port $EL_ETH_PORT			\
	--metrics $PROMETHEUS_PORT		\
	--http					\
	--http.addr 0.0.0.0			\
	--http.port $EL_ETHRPC_PORT		\
	--ipcpath /tmp/reth.ipc.$EL_ETHRPC_PORT \
	--discovery.port $EL_ETH_PORT	\
	--http.corsdomain '*'			\
	--log.file.directory $LOG_DIR		\
	--engine.persistence-threshold 0	\
	--engine.memory-block-buffer-target 0 
