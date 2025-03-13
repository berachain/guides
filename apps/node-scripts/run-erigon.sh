#!/bin/bash

set -e
. ./env.sh

BOOTNODES_OPTION=${EL_BOOTNODES:+--bootnodes $EL_BOOTNODES}
PEERS_OPTION=${EL_PEERS:+--staticpeers $EL_PEERS}
ARCHIVE_OPTION=$([ "$EL_ARCHIVE_NODE" = true ] && echo "--prune none" || echo "--prune htcr")
IP_OPTION=${MY_IP:+--nat extip:$MY_IP}

$ERIGON_BIN 					\
	--datadir $ERIGON_DATA			\
	$BOOTNODES_OPTION			\
	$PEERS_OPTION				\
	$ARCHIVE_OPTION				\
	$IP_OPTION				\
	--metrics				\
	--metrics.addr 0.0.0.0			\
	--metrics.port $PROMETHEUS_PORT		\
	--http					\
	--http.addr 0.0.0.0			\
	--http.port $EL_ETHRPC_PORT		\
	--http.vhosts "*"			\
	--http.corsdomain "*"			\
	--port $EL_ETH_PORT			\
	--p2p.allowed-ports $EL_ETH_PORT	\
	--metrics.port $PROMETHEUS_PORT		\
	--authrpc.addr 127.0.0.1		\
	--authrpc.port $EL_AUTHRPC_PORT		\
	--authrpc.jwtsecret $JWT_PATH		\
	--authrpc.vhosts localhost

