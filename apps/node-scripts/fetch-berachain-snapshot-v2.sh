#!/usr/bin/env bash
set -euo pipefail

# Restore storage v2 snapshots into $BEACOND_DATA / $RETH_DATA.
# Catalog URL shape is the same for bepolia and mainnet.
# Usage: ./fetch-berachain-snapshot-v2.sh [--help]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
source "$SCRIPT_DIR/lib-snapshot.sh"

NETWORK="${CHAIN:-mainnet}"
SNAPSHOT_TYPE="pruned"
BEACON_ONLY=0
EL_ONLY=0
FULL_CL=0
NO_DOWNLOAD=0
FORCE=0
CATALOG_URL=""
NETWORK_FROM_FLAG=0

default_catalog_url() {
  echo "https://bera-snapshots.fsn1.your-objectstorage.com/v2/$1/catalog.csv"
}

usage() {
  cat <<EOF
Bera Snapshot Restore (storage v2)

Restores beacon-kit and execution snapshots from catalog.csv into \$BEACOND_DATA
and \$RETH_DATA. Catalog URL shape is the same for both networks.
Requires curl, lz4, and tar on PATH, and bera-reth for EL restore.

Usage: ./fetch-berachain-snapshot-v2.sh [options]

Options:
  -n, --network <network>     mainnet or bepolia (default: \$CHAIN, or mainnet)
  -t, --type <type>           pruned or archive — EL preset only (default: pruned)
      --catalog-url <url>     override catalog.csv URL
      --beacond-data <dir>    consensus home (default: \$BEACOND_DATA)
      --reth-data <dir>       execution datadir (default: \$RETH_DATA)
      --beacon-only           CL restore only
      --el-only               EL restore only
      --full-cl               select cl-archive instead of cl-pruned
      --no-download, --no-extract
                              print restore commands only
      --force                 replace unexpected files in the target datadir
      --reth-bin <path>       bera-reth binary (default: PATH or \$RETH_BIN)
  -h, --help                  show this help

Catalog CSV: $(default_catalog_url mainnet) (mainnet)
             $(default_catalog_url bepolia) (bepolia)

Examples:
  . ./env.sh && ./fetch-berachain-snapshot-v2.sh
  ./fetch-berachain-snapshot-v2.sh -n bepolia -t pruned
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -n|--network)
      [[ $# -ge 2 ]] || die "--network requires a value (mainnet or bepolia)"
      NETWORK="$2"
      [[ "$NETWORK" == mainnet || "$NETWORK" == bepolia ]] || die "--network must be mainnet or bepolia"
      NETWORK_FROM_FLAG=1
      shift 2
      ;;
    -t|--type)
      [[ $# -ge 2 ]] || die "--type requires a value (pruned or archive)"
      SNAPSHOT_TYPE="$2"
      shift 2
      ;;
    --catalog-url)
      [[ $# -ge 2 ]] || die "--catalog-url requires a URL"
      CATALOG_URL="$2"
      shift 2
      ;;
    --beacond-data)
      [[ $# -ge 2 ]] || die "--beacond-data requires a directory path"
      BEACOND_DATA="$2"
      shift 2
      ;;
    --reth-data)
      [[ $# -ge 2 ]] || die "--reth-data requires a directory path"
      RETH_DATA="$2"
      shift 2
      ;;
    --reth-bin)
      [[ $# -ge 2 ]] || die "--reth-bin requires a path"
      RETH_BIN="$2"
      shift 2
      ;;
    --beacon-only) BEACON_ONLY=1; shift ;;
    --el-only) EL_ONLY=1; shift ;;
    --full-cl) FULL_CL=1; shift ;;
    --no-download|--no-extract) NO_DOWNLOAD=1; shift ;;
    --force) FORCE=1; shift ;;
    *) die "Unknown option $1" ;;
  esac
done

[[ "$BEACON_ONLY" -eq 1 && "$EL_ONLY" -eq 1 ]] && die "use only one of --beacon-only and --el-only"
[[ "$SNAPSHOT_TYPE" == pruned || "$SNAPSHOT_TYPE" == archive ]] || die "type must be either pruned or archive"

apply_network_from_env "$SCRIPT_DIR" "$NETWORK_FROM_FLAG"
if [[ "$NETWORK_FROM_FLAG" -eq 1 ]]; then
  export CHAIN="$NETWORK"
fi

RESTORE_CL=1
RESTORE_EL=1
[[ "$EL_ONLY" -eq 1 ]] && RESTORE_CL=0
[[ "$BEACON_ONLY" -eq 1 ]] && RESTORE_EL=0

EL_PRESET="--minimal"
CL_ROLE="cl-pruned"
[[ "$SNAPSHOT_TYPE" == archive ]] && EL_PRESET="--archive"
[[ "$FULL_CL" -eq 1 ]] && CL_ROLE="cl-archive"

if [[ "$NO_DOWNLOAD" -eq 0 ]]; then
  need_env=0
  [[ "$RESTORE_CL" -eq 1 && -z "${BEACOND_DATA:-}" ]] && need_env=1
  [[ "$RESTORE_EL" -eq 1 && -z "${RETH_DATA:-}" ]] && need_env=1
  [[ "$need_env" -eq 1 ]] && source_env_if_needed
  if [[ "$RESTORE_CL" -eq 1 && -z "${BEACOND_DATA:-}" ]]; then
    die "set BEACOND_DATA or pass --beacond-data (source env.sh)"
  fi
  if [[ "$RESTORE_EL" -eq 1 && -z "${RETH_DATA:-}" ]]; then
    die "set RETH_DATA or pass --reth-data (source env.sh)"
  fi
  require_cmd curl
  require_cmd lz4
  require_cmd tar
fi

[[ -n "$CATALOG_URL" ]] || CATALOG_URL="$(default_catalog_url "$NETWORK")"
RETH_CHAIN="$NETWORK"

echo "Bera Snapshot Restore (storage v2)"
echo "-------------------------"
echo "Network: $NETWORK"
echo "Type: $SNAPSHOT_TYPE"
[[ "$RESTORE_CL" -eq 1 && -n "${BEACOND_DATA:-}" ]] && echo "Beacon home: $BEACOND_DATA"
[[ "$RESTORE_EL" -eq 1 && -n "${RETH_DATA:-}" ]] && echo "Reth datadir: $RETH_DATA"
echo "Catalog: $CATALOG_URL"
echo

CATALOG="$(fetch_text "$CATALOG_URL")" || die "catalog request failed"
HEADER="$(printf '%s\n' "$CATALOG" | head -n1)"
EXPECTED_HEADER="type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role"
[[ "$HEADER" == "$EXPECTED_HEADER" ]] || die "invalid catalog header: expected $EXPECTED_HEADER, got $HEADER"

select_role() {
  local role="$1"
  local matches
  matches="$(printf '%s\n' "$CATALOG" | awk -F, -v role="$role" 'NR>1 && $9==role {print $8}')"
  local count
  count="$(printf '%s\n' "$matches" | grep -c . || true)"
  [[ "$count" -eq 1 ]] || die "expected exactly one catalog row with role $role, found $count"
  printf '%s\n' "$matches"
}

EL_MANIFEST="$(select_role el-manifest)"
CL_URL="$(select_role "$CL_ROLE")"
CL_DIR="${BEACOND_DATA:+$BEACOND_DATA/data}"
CL_DIR="${CL_DIR:-\$BEACOND_DATA/data}"
EL_DIR="${RETH_DATA:-\$RETH_DATA}"

build_el_cmd() {
  echo "bera-reth download --chain $RETH_CHAIN --manifest-url $EL_MANIFEST --datadir $EL_DIR $EL_PRESET"
}

build_cl_cmd() {
  local curl_flags="$1"
  echo "curl $curl_flags $CL_URL | lz4 -d | tar -x -C $CL_DIR --exclude=config --exclude=./config --exclude=config/priv_validator_key.json --exclude=config/jwt.hex"
}

if [[ "$NO_DOWNLOAD" -eq 1 ]]; then
  [[ "$RESTORE_EL" -eq 1 ]] && build_el_cmd
  [[ "$RESTORE_CL" -eq 1 ]] && build_cl_cmd "-fsSL"
  exit 0
fi

find_reth() {
  if [[ -n "${RETH_BIN:-}" && -x "$RETH_BIN" ]]; then
    echo "$RETH_BIN"
    return
  fi
  command -v bera-reth 2>/dev/null || true
}

assert_manifest_url() {
  local bin="$1"
  local help
  help="$("$bin" download --help 2>&1 || true)"
  echo "$help" | grep -q -- '--manifest-url' || \
    die "$bin does not support download --manifest-url. Storage v2 EL restore needs a bera-reth newer than v1.4.4."
}

RETH_RESOLVED=""
if [[ "$RESTORE_EL" -eq 1 ]]; then
  RETH_RESOLVED="$(find_reth)"
  [[ -n "$RETH_RESOLVED" ]] || die "bera-reth not found. Set RETH_BIN or pass --reth-bin."
  assert_manifest_url "$RETH_RESOLVED"
fi

PROTECTED=""
[[ "$RESTORE_CL" -eq 1 ]] && PROTECTED="$(snapshot_protected "$BEACOND_DATA")"

if [[ "$RESTORE_CL" -eq 1 ]]; then
  prepare_target_dir "$BEACOND_DATA/data" "Beacon data dir" "$FORCE" "priv_validator_state.json" "$CL_EXPECTED"
fi
if [[ "$RESTORE_EL" -eq 1 ]]; then
  prepare_target_dir "$RETH_DATA" "Reth datadir" "$FORCE" "" "$EL_EXPECTED"
fi

if [[ "$RESTORE_CL" -eq 1 ]]; then
  echo
  echo "Extracting CL snapshot into $BEACOND_DATA/data"
  mkdir -p "$BEACOND_DATA/data"
  curl -L -C - -fsSL "$CL_URL" | lz4 -d | tar -x -C "$BEACOND_DATA/data" \
    --exclude=config --exclude=./config \
    --exclude=config/priv_validator_key.json --exclude=config/jwt.hex
  ensure_priv_validator_state "$BEACOND_DATA"
fi

if [[ "$RESTORE_EL" -eq 1 ]]; then
  echo
  echo "Downloading EL snapshot into $RETH_DATA"
  "$RETH_RESOLVED" download --chain "$RETH_CHAIN" --manifest-url "$EL_MANIFEST" --datadir "$RETH_DATA" $EL_PRESET
fi

if [[ -n "$PROTECTED" ]]; then
  printf '%s\n' "$PROTECTED" | assert_protected_unchanged
fi

echo
echo "Snapshot restore complete."
