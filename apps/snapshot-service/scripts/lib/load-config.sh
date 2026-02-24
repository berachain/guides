#!/bin/bash

# load-config.sh - shared config loader for snapshot service scripts

load_snapshot_config() {
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local service_root
    service_root="$(cd "$lib_dir/../.." && pwd)"

    local default_config="$service_root/config/mainnet.env"
    local config_file="${SNAPSHOT_CONFIG_FILE:-$default_config}"

    if [[ ! -f "$config_file" ]]; then
        echo "ERROR: snapshot config file not found: $config_file" >&2
        echo "Set SNAPSHOT_CONFIG_FILE or create config/mainnet.env" >&2
        return 1
    fi

    set -a
    source "$config_file"
    set +a

    # Defaults
    : "${SNAPSHOT_DB_PATH:=/srv/snapshots/snapshots.db}"
    : "${SNAPSHOT_ROOT:=/srv/snapshots}"
    : "${SNAPSHOT_PUBLIC_ROOT:=/srv/snapshots/public}"
    : "${SNAPSHOT_TMP_DIR:=/var/tmp/snapshots}"
    : "${SNAPSHOT_INSTALLATIONS_DIR:=/srv/chain/installations}"
    : "${SNAPSHOT_BERABOX_BIN:=/opt/berabox/bb}"
    : "${SNAPSHOT_COSMPRUND_BIN:=/home/bb/ops/bin/cosmprund}"
    : "${SNAPSHOT_PYTHON_BIN:=/home/bb/ops/.venv/bin/python3}"
    : "${SNAPSHOT_SAFE_MARGIN_GB:=25}"
    : "${SNAPSHOT_FALLBACK_SIZE_GB:=500}"
    : "${SNAPSHOT_ACTIVE_TYPES:=reth-pruned,reth-archive}"
    : "${SNAPSHOT_MAX_BLOCK_LAG:=100}"
    : "${SNAPSHOT_ENV_NAME:=mainnet}"
    : "${SNAPSHOT_SITE_TITLE:=Berachain Snapshots}"
    : "${SNAPSHOT_NAV_TITLE:=Snapshots}"
    : "${SNAPSHOT_DOCS_URL:=https://docs.berachain.com}"
    : "${SNAPSHOT_LOGO_URL:=/logo-white.svg}"

    if [[ -z "${SNAPSHOT_PUBLIC_RPC:-}" ]]; then
        echo "ERROR: SNAPSHOT_PUBLIC_RPC is required in $config_file" >&2
        return 1
    fi

    if [[ -z "${SNAPSHOT_PUBLIC_URL_BASE:-}" ]]; then
        echo "ERROR: SNAPSHOT_PUBLIC_URL_BASE is required in $config_file" >&2
        return 1
    fi

    export SNAPSHOT_CONFIG_FILE="$config_file"
    export SNAPSHOT_SERVICE_ROOT="$service_root"
    export SNAPSHOT_DB_PATH SNAPSHOT_ROOT SNAPSHOT_PUBLIC_ROOT SNAPSHOT_TMP_DIR SNAPSHOT_INSTALLATIONS_DIR
    export SNAPSHOT_BERABOX_BIN SNAPSHOT_COSMPRUND_BIN SNAPSHOT_PYTHON_BIN
    export SNAPSHOT_SAFE_MARGIN_GB SNAPSHOT_FALLBACK_SIZE_GB SNAPSHOT_ACTIVE_TYPES
    export SNAPSHOT_PUBLIC_RPC SNAPSHOT_MAX_BLOCK_LAG SNAPSHOT_PUBLIC_URL_BASE SNAPSHOT_ENV_NAME
    export SNAPSHOT_SITE_TITLE SNAPSHOT_NAV_TITLE SNAPSHOT_DOCS_URL SNAPSHOT_LOGO_URL
}
