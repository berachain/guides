#!/bin/bash

set -e
. ./env.sh

./setup-geth.sh  

ARCHIVE_OPTION=$([ "$EL_ARCHIVE_NODE" = true ] && echo "--state.scheme hash --gcmode archive" || echo "--state.scheme hash")
BOOTNODES_OPTION=$([ -n "$EL_BOOTNODES" ] && echo "--bootnodes $EL_BOOTNODES" || echo "")
IP_OPTION=$([ -n "$MY_IP" ] && echo "--nat extip:$MY_IP" || echo "")
PEERS_OPTION=$([ -n "$EL_PEERS_DNS" ] && echo "--discovery.dns $EL_PEERS_DNS" || echo "")

$GETH_BIN 					\
	--datadir $GETH_DATA			\
	--syncmode full				\
	--ipcpath /tmp/geth.ipc.$EL_ETHRPC_PORT	\
	--miner.gasprice 1			\
	$BOOTNODES_OPTION			\
	$ARCHIVE_OPTION				\
	$IP_OPTION				\
	$PEERS_OPTION				\
	--metrics				\
	--metrics.addr 0.0.0.0			\
	--metrics.port $EL_PROMETHEUS_PORT	\
	--http					\
	--http.addr 0.0.0.0			\
	--http.port $EL_ETHRPC_PORT		\
	--port $EL_ETH_PORT			\
	--discovery.port $EL_ETH_PORT		\
	--authrpc.addr 127.0.0.1		\
	--authrpc.port $EL_AUTHRPC_PORT		\
	--authrpc.jwtsecret $JWT_PATH		\
	--authrpc.vhosts localhost

