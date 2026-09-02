#!/usr/bin/env bash
set -euo pipefail

# Restore pruned (or archive) Beacon Kit and Bera-Reth snapshots into
# $BEACOND_DATA / $RETH_DATA. Source env.sh first, or run from node-scripts.
# Usage: ./fetch-berachain-snapshot.sh [--help]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-snapshot.sh
source "$SCRIPT_DIR/lib-snapshot.sh"

NETWORK="${CHAIN:-mainnet}"
if [[ "$NETWORK" != mainnet && "$NETWORK" != bepolia ]]; then
  NETWORK=mainnet
fi
SNAPSHOT_TYPE="pruned"
OUTPUT_DIR="downloads"
BEACON_ONLY=0
EL_ONLY=0
NO_EXTRACT=0
FORCE=0
NETWORK_FROM_FLAG=0

usage() {
  cat <<EOF
Bera Snapshot Restore

Downloads beacon-kit and execution snapshots from the Berachain snapshot index
and extracts them into \$BEACOND_DATA and \$RETH_DATA.
Requires curl, lz4, and tar on PATH.

Usage: ./fetch-berachain-snapshot.sh [options]

Options:
  -n, --network <network>     mainnet or bepolia (default: \$CHAIN, or mainnet)
  -t, --type <type>           pruned or archive (default: pruned)
  -o, --output <dir>          tarball cache directory (default: downloads)
      --beacond-data <dir>    consensus home (default: \$BEACOND_DATA)
      --reth-data <dir>       execution datadir (default: \$RETH_DATA)
      --beacon-only           beacon-kit snapshot only
      --el-only               execution-layer snapshot only
      --no-extract            download tarballs and print extract commands
      --force                 replace unexpected files in the target datadir
  -h, --help                  show this help

Index CSV: https://snapshots.berachain.com/index.csv (mainnet)
           https://bepolia.snapshots.berachain.com/index.csv (bepolia)

Examples:
  . ./env.sh && ./fetch-berachain-snapshot.sh
  ./fetch-berachain-snapshot.sh -n bepolia -t pruned
EOF
}

default_index_url() {
  local network="$1"
  if [[ "$network" == bepolia ]]; then
    echo "https://bepolia.snapshots.berachain.com/index.csv"
  else
    echo "https://snapshots.berachain.com/index.csv"
  fi
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
    -o|--output)
      [[ $# -ge 2 ]] || die "--output requires a directory path"
      OUTPUT_DIR="$2"
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
    --beacon-only) BEACON_ONLY=1; shift ;;
    --el-only) EL_ONLY=1; shift ;;
    --no-extract) NO_EXTRACT=1; shift ;;
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

if [[ "$NO_EXTRACT" -eq 0 ]]; then
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
else
  require_cmd curl
fi

INDEX_URL="$(default_index_url "$NETWORK")"

echo "Bera Snapshot Restore"
echo "-------------------------"
echo "Network: $NETWORK"
echo "Type: $SNAPSHOT_TYPE"
echo "Tarball cache: $(mkdir -p "$OUTPUT_DIR" && cd "$OUTPUT_DIR" && pwd)"
[[ "$RESTORE_CL" -eq 1 && -n "${BEACOND_DATA:-}" ]] && echo "Beacon home: $BEACOND_DATA"
[[ "$RESTORE_EL" -eq 1 && -n "${RETH_DATA:-}" ]] && echo "Reth datadir: $RETH_DATA"
echo "Index: $INDEX_URL"
echo
echo "Fetching snapshot index..."
echo

INDEX_CSV="$(fetch_text "$INDEX_URL")" || die "index request failed"

HEADER="$(printf '%s\n' "$INDEX_CSV" | head -n1)"
echo "$HEADER" | grep -q 'type' || die "Unexpected CSV format: missing required columns"
echo "$HEADER" | grep -q 'url' || die "Unexpected CSV format: missing required columns"

BEACON_TYPE="beacon-kit-${SNAPSHOT_TYPE}"
EL_TYPE="reth-${SNAPSHOT_TYPE}"

# Prefer url_s3 over url. Pick the latest created_at per type.
select_latest() {
  local want_type="$1"
  printf '%s\n' "$INDEX_CSV" | awk -F, -v want="$want_type" '
    NR==1 {
      for (i=1;i<=NF;i++) {
        if ($i=="type") t=i
        if ($i=="url") u=i
        if ($i=="url_s3") s=i
        if ($i=="created_at") c=i
      }
      next
    }
    $t==want {
      url=$u
      if (s>0 && $(s)!="") url=$(s)
      if ($c >= best) { best=$c; pick=url }
    }
    END { if (pick!="") print pick }
  '
}

BEACON_URL=""
EL_URL=""
[[ "$RESTORE_CL" -eq 1 ]] && BEACON_URL="$(select_latest "$BEACON_TYPE")"
[[ "$RESTORE_EL" -eq 1 ]] && EL_URL="$(select_latest "$EL_TYPE")"

[[ "$RESTORE_CL" -eq 1 && -z "$BEACON_URL" ]] && die "no snapshot found for $BEACON_TYPE"
[[ "$RESTORE_EL" -eq 1 && -z "$EL_URL" ]] && die "no snapshot found for $EL_TYPE"

echo "Will download the following files:"
if [[ -n "$BEACON_URL" ]]; then
  BEACON_NAME="$(basename "${BEACON_URL%%\?*}")"
  echo "  $BEACON_NAME (beacon)"
  echo "    URL: $BEACON_URL"
fi
if [[ -n "$EL_URL" ]]; then
  EL_NAME="$(basename "${EL_URL%%\?*}")"
  echo "  $EL_NAME (execution layer)"
  echo "    URL: $EL_URL"
fi
echo

mkdir -p "$OUTPUT_DIR"
download_one() {
  local url="$1" dest="$2"
  echo "Starting download: $(basename "$dest")"
  echo "Downloading $(basename "$dest")"
  curl -L -C - -o "$dest" "$url"
  echo
  echo "$(basename "$dest") - Complete"
}

BEACON_PATH=""
EL_PATH=""
if [[ -n "$BEACON_URL" ]]; then
  BEACON_PATH="$OUTPUT_DIR/$BEACON_NAME"
  download_one "$BEACON_URL" "$BEACON_PATH"
fi
if [[ -n "$EL_URL" ]]; then
  EL_PATH="$OUTPUT_DIR/$EL_NAME"
  download_one "$EL_URL" "$EL_PATH"
fi

echo
echo "All downloads completed!"

if [[ "$NO_EXTRACT" -eq 1 ]]; then
  if [[ -n "$BEACON_PATH" ]]; then
    dest="${BEACOND_DATA:-\$BEACOND_DATA}/data"
    if [[ -n "${BEACOND_DATA:-}" ]]; then
      dest="$(cl_extract_dir "$BEACON_PATH" "$BEACOND_DATA")"
    fi
    extract_cmd "$BEACON_PATH" "$dest"
  fi
  if [[ -n "$EL_PATH" ]]; then
    dest="${RETH_DATA:-\$RETH_DATA}"
    if [[ -n "${RETH_DATA:-}" ]]; then
      dest="$(el_extract_dir "$EL_PATH" "$RETH_DATA")"
    fi
    extract_cmd "$EL_PATH" "$dest"
  fi
  exit 0
fi

PROTECTED=""
if [[ "$RESTORE_CL" -eq 1 ]]; then
  PROTECTED="$(snapshot_protected "$BEACOND_DATA")"
fi

if [[ -n "$BEACON_PATH" ]]; then
  dest="$(cl_extract_dir "$BEACON_PATH" "$BEACOND_DATA")"
  prepare_target_dir "$BEACOND_DATA/data" "Beacon data dir" "$FORCE" "priv_validator_state.json" "$CL_EXPECTED"
  echo
  echo "Extracting $BEACON_NAME into $dest"
  run_extract "$BEACON_PATH" "$dest"
  ensure_priv_validator_state "$BEACOND_DATA"
fi

if [[ -n "$EL_PATH" ]]; then
  dest="$(el_extract_dir "$EL_PATH" "$RETH_DATA")"
  prepare_target_dir "$RETH_DATA" "Reth datadir" "$FORCE" "" "$EL_EXPECTED"
  echo
  echo "Extracting $EL_NAME into $dest"
  run_extract "$EL_PATH" "$dest"
fi

if [[ -n "$PROTECTED" ]]; then
  printf '%s\n' "$PROTECTED" | assert_protected_unchanged
fi

echo
echo "Snapshot restore complete."
