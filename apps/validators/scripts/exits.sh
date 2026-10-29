#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/find-all-exits.sh [output.csv]
# START_BLOCK=4021622 END_BLOCK=4031622 ./scripts/find-all-exits.sh --append [output.csv]
#
# Optional:
# RPC_URL=https://... START_BLOCK=4021622 END_BLOCK=0 CHUNK_SIZE=10000 ./scripts/find-all-exits.sh
# GENESIS_FILE=./out/genesis.json ./scripts/find-all-exits.sh ./files/exits.csv
#
# The CSV is written to files/exits.csv unless another path is given.
#
# --append scans only the START_BLOCK to END_BLOCK range and adds the
# exits it finds to the existing CSV. Both block variables must already
# be set. END_BLOCK=0 still means the chain head. A withdrawal request
# whose transaction and log index are already in the CSV is not written again.
#
# Values in .env at the repository root are used when the same variable is not already set.
#
# END_BLOCK defaults to the latest block. Set END_BLOCK=0 to scan through the
# chain head, including blocks produced while the search is running.
#
# Withdrawal requests are sent to the EIP-7002 predeploy and emit an
# anonymous log. Successful requests are 76-byte logs:
#   20-byte caller || 48-byte validator pubkey || uint64 amount
# The amount is big-endian gwei. 0 requests a full exit; any other
# value is a partial withdrawal.
# https://docs.berachain.com/nodes/guides/withdraw-stake
#
# amount is BERA. amount_gwei is the uint64 value from the request log.
# withdrawal_address is the 20-byte caller, which must be the validator's
# withdrawal credential. from is the wallet that sent the transaction.
# to is the address that transaction was sent to.
# request_type is "Full exit" or "Partial withdrawal".
#
# Columns follow deposits.csv where the same fields exist:
# date, pubkey, withdrawal_address, amount, amount_gwei, block_number,
# from, to, log_index, txhash, request_type, then index.
#
# out/genesis.json is created when missing, from the beacon-kit mainnet
# genesis file, then read before the scan:
# https://github.com/berachain/beacon-kit/blob/main/testing/networks/80094/genesis.json
# index is the genesis deposit index for that pubkey. Exit logs do not
# carry it, so validators that are not in genesis.json have an empty index.

RPC_URL_DEFAULT="https://rpc.berachain.com"
CONTRACT="0x00000961Ef480Eb55e80D19ad83579A64c007002"
GENESIS_URL="https://raw.githubusercontent.com/berachain/beacon-kit/main/testing/networks/80094/genesis.json"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

load_env() {
  local file="$1" line key val
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" && "$line" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -z "${!key+x}" ]]; then
      export "$key=$val"
    fi
  done < "$file"
}

load_env "$ROOT_DIR/.env"

APPEND=0
OUTPUT_ARG=""
for arg in "$@"; do
  case "$arg" in
    --append)
      APPEND=1
      ;;
    --)
      ;;
    -*)
      echo "Error: Unknown option: $arg" >&2
      exit 1
      ;;
    *)
      if [[ -n "$OUTPUT_ARG" ]]; then
        echo "Error: Unexpected argument: $arg" >&2
        exit 1
      fi
      OUTPUT_ARG="$arg"
      ;;
  esac
done

RPC_URL="${RPC_URL:-$RPC_URL_DEFAULT}"
GENESIS_FILE="${GENESIS_FILE:-$ROOT_DIR/out/genesis.json}"
OUTPUT="${OUTPUT_ARG:-${OUTPUT:-$ROOT_DIR/files/exits.csv}}"
mkdir -p "$(dirname "$OUTPUT")"

if (( APPEND )); then
  if [[ -z "${START_BLOCK:-}" || -z "${END_BLOCK:-}" ]]; then
    echo "Error: --append requires START_BLOCK and END_BLOCK" >&2
    exit 1
  fi
fi

# First block of the Berachain Bectra upgrade (2025-06-04 17:00:00 UTC),
# when this predeploy started accepting withdrawal requests.
START_BLOCK="${START_BLOCK:-4021622}"
END_BLOCK_FROM_LATEST=0
if [[ -z "${END_BLOCK:-}" ]]; then
  END_BLOCK_FROM_LATEST=1
fi
CHUNK_SIZE="${CHUNK_SIZE:-9999}"
MAX_ATTEMPTS=5
CSV_HEADER="date,pubkey,withdrawal_address,amount,amount_gwei,block_number,from,to,log_index,txhash,request_type,index"

if (( END_BLOCK_FROM_LATEST )); then
  if ! [[ "$START_BLOCK" =~ ^[0-9]+$ && "$CHUNK_SIZE" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: Invalid START_BLOCK or CHUNK_SIZE" >&2
    exit 1
  fi
elif ! [[ "$START_BLOCK" =~ ^[0-9]+$ && "$END_BLOCK" =~ ^[0-9]+$ && "$CHUNK_SIZE" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: Invalid START_BLOCK, END_BLOCK, or CHUNK_SIZE" >&2
  exit 1
fi

for cmd in cast jq date; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is required" >&2
    exit 1
  fi
done

# Beacon-kit mainnet genesis. The blob page is HTML, so the file is fetched
# from the raw URL for that same path. An existing file is left in place;
# load_genesis reads it.
ensure_genesis() {
  local out_dir tmp

  out_dir=$(dirname "$GENESIS_FILE")
  mkdir -p "$out_dir"
  if [[ -s "$GENESIS_FILE" ]]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required to download genesis.json" >&2
    exit 1
  fi

  echo "Downloading genesis.json to $GENESIS_FILE..." >&2
  tmp=$(mktemp "$out_dir/genesis.json.XXXXXX")
  if ! curl -fsSL "$GENESIS_URL" -o "$tmp"; then
    rm -f "$tmp"
    echo "Error: Failed to download genesis.json" >&2
    exit 1
  fi
  if ! jq -e . "$tmp" >/dev/null; then
    rm -f "$tmp"
    echo "Error: Downloaded genesis.json is not valid JSON" >&2
    exit 1
  fi
  mv "$tmp" "$GENESIS_FILE"
}

# pubkey -> genesis deposit index. Written once and consulted for every exit.
load_genesis() {
  local expected rows

  if [[ ! -f "$GENESIS_FILE" ]]; then
    echo "Error: Genesis file not found: $GENESIS_FILE" >&2
    exit 1
  fi

  expected=$(jq '.app_state.beacon.deposits | length' "$GENESIS_FILE")
  if ! [[ "$expected" =~ ^[0-9]+$ ]]; then
    echo "Error: Could not read deposits from $GENESIS_FILE" >&2
    exit 1
  fi

  GENESIS_INDEX_FILE="$CACHE_DIR/genesis-index.tsv"
  jq -r '
    .app_state.beacon.deposits[]
    | (.pubkey | ascii_downcase) as $pk
    | (if ($pk | startswith("0x")) then $pk else "0x" + $pk end) as $pubkey
    | [$pubkey, (.index | tostring)]
    | @tsv
  ' "$GENESIS_FILE" > "$GENESIS_INDEX_FILE"

  rows=$(wc -l < "$GENESIS_INDEX_FILE" | tr -d '[:space:]')
  if [[ "$rows" != "$expected" ]]; then
    echo "Error: Read $rows of $expected genesis validators from $GENESIS_FILE" >&2
    exit 1
  fi
  echo "Reading $expected genesis validators from $GENESIS_FILE" >&2
}

genesis_index() {
  local pubkey="$1"
  awk -F '\t' -v pk="$pubkey" '
    $1 == pk { print $2; found = 1; exit }
    END { if (!found) printf "" }
  ' "$GENESIS_INDEX_FILE"
}

format_bera() {
  local gwei="$1"
  local bera
  bera=$(cast from-wei "$(cast to-wei "$gwei" gwei)" ether)
  if [[ "$bera" == *.* ]]; then
    bera="${bera%%.000000000000000000}"
  fi
  if [[ "$bera" == *.* ]]; then
    bera="${bera%"${bera##*[!0]}"}"
  fi
  printf '%s\n' "$bera"
}

format_date() {
  local ts="$1"
  if [[ "$ts" == 0x* || "$ts" == 0X* ]]; then
    ts=$(cast to-dec "$ts")
  fi
  date -u -r "$ts" +%Y-%m-%dT%H:%M:%SZ
}

to_dec() {
  local value="$1"
  if [[ "$value" == 0x* || "$value" == 0X* ]]; then
    cast to-dec "$value"
  else
    printf '%s\n' "$value"
  fi
}

normalize_hex() {
  local value
  value=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  value="${value#0x}"
  printf '0x%s\n' "$value"
}

# Print the command's full stderr, then exit.
report_error() {
  local status="$1"
  local errfile="$2"
  local stdout="${3-}"

  echo >&2
  if [[ -s "$errfile" ]]; then
    cat "$errfile" >&2
  elif [[ -n "$stdout" ]]; then
    printf '%s\n' "$stdout" >&2
  fi
  rm -f "$errfile"
  exit "$status"
}

# Run a command, printing each failed attempt before trying again.
run_with_retries() {
  local description="$1"
  shift
  local attempt=1 status err

  err=$(mktemp)
  while true; do
    if (( attempt > 1 )); then
      echo "Connection attempt $attempt/$MAX_ATTEMPTS: $description" >&2
    fi
    set +e
    "$@" 2>"$err"
    status=$?
    set -e
    if (( status == 0 )); then
      rm -f "$err"
      return 0
    fi
    if (( attempt >= MAX_ATTEMPTS )); then
      echo "Connection attempt $attempt/$MAX_ATTEMPTS failed: $description" >&2
      report_error "$status" "$err"
    fi
    echo "Connection attempt $attempt/$MAX_ATTEMPTS failed: $description" >&2
    if [[ -s "$err" ]]; then
      cat "$err" >&2
    fi
    echo "Retrying in $((attempt * 2))s..." >&2
    sleep $((attempt * 2))
    attempt=$((attempt + 1))
  done
}

CACHE_DIR=$(mktemp -d)
SEEN_DIR="$CACHE_DIR/seen"
mkdir -p "$SEEN_DIR"
trap 'rm -rf "$CACHE_DIR"' EXIT

EXIT_COUNT=0
FULL_EXIT_COUNT=0
PARTIAL_COUNT=0
DUPLICATE_COUNT=0

csv_column_index() {
  local name="$1"
  local -a cols
  local i=0 col
  IFS=',' read -r -a cols <<< "$CSV_HEADER"
  for col in "${cols[@]}"; do
    if [[ "$col" == "$name" ]]; then
      printf '%s\n' "$i"
      return 0
    fi
    i=$((i + 1))
  done
  echo "Error: CSV header is missing $name" >&2
  exit 1
}

COL_LOG_INDEX=$(csv_column_index log_index)
COL_TXHASH=$(csv_column_index txhash)

block_date() {
  local block="$1"
  local cache="$CACHE_DIR/$block"
  local ts json

  if [[ -f "$cache" ]]; then
    cat "$cache"
    return 0
  fi

  json=$(run_with_retries "reading block $block" \
    cast block "$block" --rpc-url "$RPC_URL" --json)
  ts=$(printf '%s\n' "$json" | jq -r '.timestamp')
  if [[ -z "$ts" || "$ts" == "null" ]]; then
    echo "Block $block did not include a timestamp" >&2
    exit 1
  fi
  format_date "$ts" | tee "$cache"
}

# Sender and recipient of the withdrawal transaction. Cached per hash because one
# transaction can emit more than one withdrawal log. Prints from and to, tab-separated.
tx_addresses() {
  local tx="$1"
  local cache="$CACHE_DIR/tx-$tx"
  local json from to

  if [[ -f "$cache" ]]; then
    cat "$cache"
    return 0
  fi

  json=$(run_with_retries "reading transaction $tx" \
    cast tx "$tx" --rpc-url "$RPC_URL" --json)
  from=$(printf '%s\n' "$json" | jq -r '.from // empty')
  to=$(printf '%s\n' "$json" | jq -r '.to // empty')
  from="${from//[[:space:]]/}"
  to="${to//[[:space:]]/}"
  from=$(normalize_hex "$from")
  to=$(normalize_hex "$to")
  if [[ ! "$from" =~ ^0x[0-9a-f]{40}$ ]]; then
    echo "Transaction $tx did not include a sender wallet" >&2
    exit 1
  fi
  if [[ ! "$to" =~ ^0x[0-9a-f]{40}$ ]]; then
    echo "Transaction $tx did not include a recipient" >&2
    exit 1
  fi
  printf '%s\t%s\n' "$from" "$to" | tee "$cache"
}

csv_row() {
  local out="" field escaped
  for field in "$@"; do
    escaped=${field//\"/\"\"}
    if [[ -n "$out" ]]; then
      out+=","
    fi
    out+="\"${escaped}\""
  done
  printf '%s\n' "$out" >> "$OUTPUT"
}

# Split one data row written by csv_row. Every field is quoted.
split_csv_row() {
  local line="$1" field
  line="${line%$'\r'}"
  line="${line#\"}"
  line="${line%\"}"
  CSV_FIELDS=()
  while IFS= read -r field || [[ -n "$field" ]]; do
    CSV_FIELDS+=("$field")
  done <<< "${line//\",\"/$'\n'}"
}

# One transaction can contain more than one withdrawal log.
exit_seen_file() {
  local txhash="$1" log_index="$2"
  printf '%s/log-%s-%s\n' "$SEEN_DIR" "${txhash//\//_}" "${log_index:-empty}"
}

exit_is_duplicate() {
  local path
  path=$(exit_seen_file "$@")
  [[ -e "$path" ]]
}

remember_exit() {
  local path
  path=$(exit_seen_file "$@")
  : > "$path"
}

load_seen_exits() {
  local line txhash log_index count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -n "$line" ]] || continue
    split_csv_row "$line"
    if (( ${#CSV_FIELDS[@]} <= COL_TXHASH )); then
      echo "Error: $OUTPUT has a row with too few columns" >&2
      exit 1
    fi
    log_index="${CSV_FIELDS[$COL_LOG_INDEX]}"
    txhash="${CSV_FIELDS[$COL_TXHASH]}"
    remember_exit "$txhash" "$log_index"
    count=$((count + 1))
  done < <(tail -n +2 "$OUTPUT")
  echo "Existing withdrawal requests: $count" >&2
}

append_exit() {
  local date="$1"
  local pubkey="$2"
  local amount_gwei="$3"
  local txhash="$4"
  local withdrawal_address="$5"
  local block="$6"
  local log_index="$7"
  local amount request_type parties from_address to_address label index

  pubkey=$(normalize_hex "$pubkey")
  txhash=$(normalize_hex "$txhash")
  withdrawal_address=$(normalize_hex "$withdrawal_address")

  if [[ ! "$pubkey" =~ ^0x[0-9a-f]{96}$ ]]; then
    echo "Skipping withdrawal request with unexpected pubkey at block $block" >&2
    return 0
  fi
  if [[ ! "$withdrawal_address" =~ ^0x[0-9a-f]{40}$ ]]; then
    echo "Skipping withdrawal request with unexpected caller at block $block tx $txhash" >&2
    return 0
  fi
  if [[ ! "$txhash" =~ ^0x[0-9a-f]{64}$ ]]; then
    echo "Skipping withdrawal request with unexpected transaction at block $block" >&2
    return 0
  fi
  if exit_is_duplicate "$txhash" "$log_index"; then
    DUPLICATE_COUNT=$((DUPLICATE_COUNT + 1))
    return 0
  fi

  amount=$(format_bera "$amount_gwei")
  if [[ "$amount_gwei" == "0" ]]; then
    request_type="Full exit"
    label="Exit"
    FULL_EXIT_COUNT=$((FULL_EXIT_COUNT + 1))
  else
    request_type="Partial withdrawal"
    label="Partial withdrawal"
    PARTIAL_COUNT=$((PARTIAL_COUNT + 1))
  fi

  parties=$(tx_addresses "$txhash")
  from_address="${parties%%$'\t'*}"
  to_address="${parties#*$'\t'}"
  index=$(genesis_index "$pubkey")

  csv_row \
    "$date" \
    "$pubkey" \
    "$withdrawal_address" \
    "$amount" \
    "$amount_gwei" \
    "$block" \
    "$from_address" \
    "$to_address" \
    "$log_index" \
    "$txhash" \
    "$request_type" \
    "$index"
  remember_exit "$txhash" "$log_index"
  EXIT_COUNT=$((EXIT_COUNT + 1))
  if [[ -n "$index" ]]; then
    echo "$label found: block $block  amount $amount BERA  pubkey $pubkey  index $index  tx $txhash  from $from_address" >&2
  else
    echo "$label found: block $block  amount $amount BERA  pubkey $pubkey  tx $txhash  from $from_address" >&2
  fi
}

write_header() {
  printf '%s\n' "$CSV_HEADER" > "$OUTPUT"
}

prepare_append() {
  local header
  if [[ ! -f "$OUTPUT" ]]; then
    echo "Error: CSV not found: $OUTPUT" >&2
    exit 1
  fi
  header=$(head -n 1 "$OUTPUT" | tr -d '\r')
  if [[ "$header" != "$CSV_HEADER" ]]; then
    echo "Error: $OUTPUT does not have the expected exit CSV header" >&2
    exit 1
  fi
  if [[ -s "$OUTPUT" && -n "$(tail -c 1 "$OUTPUT")" ]]; then
    printf '\n' >> "$OUTPUT"
  fi
  load_seen_exits
}

search_logs() {
  local from="$1"
  local to="$2"
  local logs parsed err status
  local pubkey amount_hex caller tx block log_index
  local amount_gwei date

  echo "Scanning blocks $from to $to ($EXIT_COUNT withdrawal requests so far)" >&2

  logs=$(run_with_retries "scanning blocks $from to $to" \
    cast logs \
    --rpc-url "$RPC_URL" \
    --address "$CONTRACT" \
    --from-block "$from" \
    --to-block "$to" \
    --json)
  if [[ -z "$logs" || "$logs" == "null" ]]; then
    logs='[]'
  fi

  err=$(mktemp)
  set +e
  parsed=$(printf '%s\n' "$logs" | jq -r '
    def hexdec:
      ltrimstr("0x") | explode | reduce .[] as $c (0;
        . * 16 + (
          if $c >= 48 and $c <= 57 then $c - 48
          elif $c >= 97 and $c <= 102 then $c - 87
          elif $c >= 65 and $c <= 70 then $c - 55
          else 0 end
        ));
    [
      .[]
      | select(.removed != true)
      | (.data // "" | ascii_downcase) as $d
      | select(($d | length) == 154)
      | {
          pubkey: ("0x" + $d[42:138]),
          amount: ("0x" + $d[138:154]),
          caller: ("0x" + $d[2:42]),
          tx: (.transactionHash // "" | ascii_downcase),
          block: (.blockNumber | hexdec),
          logIndex: ((.logIndex // "0x0") | hexdec)
        }
    ]
    | sort_by([.block, .logIndex])
    | .[]
    | [.pubkey, .amount, .caller, .tx, (.block | tostring), (.logIndex | tostring)]
    | @tsv
  ' 2>"$err")
  status=$?
  set -e
  if (( status != 0 )); then
    report_error "$status" "$err" "$logs"
  fi
  rm -f "$err"

  [[ -n "$parsed" ]] || return 0

  while IFS=$'\t' read -r pubkey amount_hex caller tx block log_index; do
    [[ -n "$pubkey" ]] || continue
    amount_gwei=$(to_dec "$amount_hex")
    date=$(block_date "$block")
    append_exit \
      "$date" \
      "$pubkey" \
      "$amount_gwei" \
      "$tx" \
      "$caller" \
      "$block" \
      "$log_index"
  done <<< "$parsed"
}

scan_chunked() {
  local from="$1"
  local to
  while (( from <= END_BLOCK )); do
    to=$((from + CHUNK_SIZE - 1))
    if (( to > END_BLOCK )); then to=$END_BLOCK; fi
    search_logs "$from" "$to"
    from=$((to + 1))
    if (( OPEN_ENDED )) && (( from > END_BLOCK )); then
      END_BLOCK=$(run_with_retries "reading the chain head" \
        cast block-number --rpc-url "$RPC_URL")
    fi
  done
}

ensure_genesis
load_genesis

if (( APPEND )); then
  prepare_append
  echo "Appending withdrawal requests to: $OUTPUT" >&2
else
  write_header
  echo "Writing withdrawal requests to: $OUTPUT" >&2
fi

echo "Reading chain head..." >&2
LATEST=$(run_with_retries "reading the chain head" \
  cast block-number --rpc-url "$RPC_URL")
OPEN_ENDED=0
END_BLOCK_IS_LATEST=0

if (( END_BLOCK_FROM_LATEST )); then
  END_BLOCK=$LATEST
  END_BLOCK_IS_LATEST=1
elif [[ "$END_BLOCK" == "0" ]]; then
  OPEN_ENDED=1
  END_BLOCK=$LATEST
  END_BLOCK_IS_LATEST=1
elif (( END_BLOCK > LATEST )); then
  END_BLOCK=$LATEST
  END_BLOCK_IS_LATEST=1
fi

if (( START_BLOCK > END_BLOCK )); then
  echo "Error: START_BLOCK is after END_BLOCK" >&2
  exit 1
fi

echo "Latest block is $LATEST" >&2
echo "START_BLOCK=$START_BLOCK" >&2
if (( END_BLOCK_IS_LATEST )); then
  echo "END_BLOCK=$END_BLOCK (latest)" >&2
else
  echo "END_BLOCK=$END_BLOCK" >&2
fi
echo "Chunk size: $CHUNK_SIZE" >&2

scan_chunked "$START_BLOCK"

echo >&2
if (( APPEND )); then
  echo "Appended $EXIT_COUNT withdrawal requests to $OUTPUT ($FULL_EXIT_COUNT full exits, $PARTIAL_COUNT partial withdrawals)"
else
  echo "Wrote $EXIT_COUNT withdrawal requests to $OUTPUT ($FULL_EXIT_COUNT full exits, $PARTIAL_COUNT partial withdrawals)"
fi
if (( DUPLICATE_COUNT > 0 )); then
  echo "Skipped $DUPLICATE_COUNT duplicate withdrawal requests"
fi
