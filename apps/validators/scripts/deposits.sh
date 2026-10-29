#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/find-all-deposits.sh [output.csv]
# START_BLOCK=15403512 END_BLOCK=15403512 ./scripts/find-all-deposits.sh --append [output.csv]
#
# Optional:
# RPC_URL=https://... START_BLOCK=516370 END_BLOCK=0 CHUNK_SIZE=2000 ./scripts/find-all-deposits.sh
# INCLUDE_GENESIS=0 ./scripts/find-all-deposits.sh ./files/deposits.csv
# DEPOSIT_BLOCKS=./deposit-blocks.csv GENESIS_FILE=./out/genesis.json ./scripts/find-all-deposits.sh
#
# The CSV is written to files/deposits.csv unless another path is given.
#
# --append scans only the START_BLOCK to END_BLOCK range, skips genesis.json,
# and adds the deposits it finds to the existing CSV. Both block variables
# must already be set. END_BLOCK=0 still means the chain head. A deposit
# whose index is already in the CSV is not written again.
#
# Values in .env at the repository root are used when the same variable is not already set.
#
# END_BLOCK defaults to the latest block. Set END_BLOCK=0 to scan through the
# chain head, including blocks produced while the search is running.
#
# amount is BERA. amount_gwei is the uint64 value from the deposit event.
# withdrawal_credentials is the full 32-byte value. withdrawal_address is the
# 20-byte address inside 0x01 and 0x02 credentials, or empty otherwise.
# signature is the 96-byte
# deposit signature. from is the wallet that sent the deposit transaction.
# to is the address that transaction was sent to.
#
# Every deposit in genesis.json is written before the chain scan. Those
# rows use txhash "genesis", block_number 0, empty from and to, and the
# beacon genesis time.
#
# out/genesis.json is created when missing, from the beacon-kit mainnet
# genesis file:
# https://github.com/berachain/beacon-kit/blob/main/testing/networks/80094/genesis.json
#
# deposit-blocks.csv lists every execution block that emitted a deposit
# event. When that file exists, the search queries those blocks inside
# the requested range, then keeps scanning after the last listed block.

RPC_URL_DEFAULT="https://rpc.berachain.com"
CONTRACT="0x4242424242424242424242424242424242424242"
GENESIS_URL="https://raw.githubusercontent.com/berachain/beacon-kit/main/testing/networks/80094/genesis.json"
TOPIC="0x68af751683498a9f9be59fe8b0d52a64dd155255d85cdb29fea30b1e3f891d46"

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
BLOCKS_FILE="${DEPOSIT_BLOCKS:-$ROOT_DIR/deposit-blocks.csv}"
GENESIS_FILE="${GENESIS_FILE:-$ROOT_DIR/out/genesis.json}"
OUTPUT="${OUTPUT_ARG:-${OUTPUT:-$ROOT_DIR/files/deposits.csv}}"
mkdir -p "$(dirname "$OUTPUT")"

if (( APPEND )); then
  if [[ -z "${START_BLOCK:-}" || -z "${END_BLOCK:-}" ]]; then
    echo "Error: --append requires START_BLOCK and END_BLOCK" >&2
    exit 1
  fi
  INCLUDE_GENESIS=0
fi

START_BLOCK="${START_BLOCK:-516370}"
END_BLOCK_FROM_LATEST=0
if [[ -z "${END_BLOCK:-}" ]]; then
  END_BLOCK_FROM_LATEST=1
fi
CHUNK_SIZE="${CHUNK_SIZE:-9999}"
INCLUDE_GENESIS="${INCLUDE_GENESIS:-1}"
MAX_ATTEMPTS=5
CSV_HEADER="date,pubkey,withdrawal_credentials,withdrawal_address,amount,amount_gwei,signature,index,block_number,from,to,log_index,txhash,source"

if (( END_BLOCK_FROM_LATEST )); then
  if ! [[ "$START_BLOCK" =~ ^[0-9]+$ && "$CHUNK_SIZE" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: Invalid START_BLOCK or CHUNK_SIZE" >&2
    exit 1
  fi
elif ! [[ "$START_BLOCK" =~ ^[0-9]+$ && "$END_BLOCK" =~ ^[0-9]+$ && "$CHUNK_SIZE" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: Invalid START_BLOCK, END_BLOCK, or CHUNK_SIZE" >&2
  exit 1
fi

if ! [[ "$INCLUDE_GENESIS" =~ ^[01]$ ]]; then
  echo "Error: INCLUDE_GENESIS must be 0 or 1" >&2
  exit 1
fi

for cmd in cast jq date; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is required" >&2
    exit 1
  fi
done

# Beacon-kit mainnet genesis. The blob page is HTML, so the file is fetched
# from the raw URL for that same path.
ensure_genesis() {
  local out_dir="$ROOT_DIR/out"
  local genesis_file="$out_dir/genesis.json"
  local tmp

  mkdir -p "$out_dir"
  if [[ -s "$genesis_file" ]]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required to download genesis.json" >&2
    exit 1
  fi

  echo "Downloading genesis.json to $genesis_file..." >&2
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
  mv "$tmp" "$genesis_file"
}

# ABI layout for Deposit(bytes,bytes,uint64,bytes,uint64):
# Head: 5 * 32 bytes. Amount and index sit in the head as uint64.
# Pubkey: 48 bytes, first dynamic field, data[386:482]
# Credentials: 32 bytes, second dynamic field, data[578:642]
# Amount: data[178:194]. Index: data[306:322]. Signature: data[706:898]
# Offsets include the leading 0x and assume the fixed Berachain sizes.

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

DEPOSIT_COUNT=0
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

COL_INDEX=$(csv_column_index index)
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

# Sender and recipient of the deposit transaction. Cached per hash because one
# transaction can emit more than one deposit log. Prints from and to, tab-separated.
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

# Deposit index is unique. Rows without one are keyed by transaction and log.
deposit_seen_file() {
  local index="$1" txhash="$2" log_index="$3"
  if [[ "$index" =~ ^[0-9]+$ ]]; then
    printf '%s/index-%s\n' "$SEEN_DIR" "$index"
  else
    printf '%s/log-%s-%s\n' "$SEEN_DIR" "${txhash//\//_}" "${log_index:-empty}"
  fi
}

deposit_is_duplicate() {
  local path
  path=$(deposit_seen_file "$@")
  [[ -e "$path" ]]
}

remember_deposit() {
  local path
  path=$(deposit_seen_file "$@")
  : > "$path"
}

load_seen_deposits() {
  local line index txhash log_index count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -n "$line" ]] || continue
    split_csv_row "$line"
    if (( ${#CSV_FIELDS[@]} <= COL_TXHASH )); then
      echo "Error: $OUTPUT has a row with too few columns" >&2
      exit 1
    fi
    index="${CSV_FIELDS[$COL_INDEX]}"
    log_index="${CSV_FIELDS[$COL_LOG_INDEX]}"
    txhash="${CSV_FIELDS[$COL_TXHASH]}"
    remember_deposit "$index" "$txhash" "$log_index"
    count=$((count + 1))
  done < <(tail -n +2 "$OUTPUT")
  echo "Existing deposits: $count" >&2
}

append_deposit() {
  local date="$1"
  local pubkey="$2"
  local amount_gwei="$3"
  local txhash="$4"
  local credentials="$5"
  local index="$6"
  local signature="$7"
  local block="$8"
  local log_index="$9"
  local source="${10}"
  local amount parties from_address to_address withdrawal_address prefix

  pubkey=$(normalize_hex "$pubkey")
  credentials=$(normalize_hex "$credentials")
  signature=$(normalize_hex "$signature")
  if [[ "$txhash" != "genesis" ]]; then
    txhash=$(normalize_hex "$txhash")
  fi

  if [[ ! "$pubkey" =~ ^0x[0-9a-f]{96}$ ]]; then
    echo "Skipping deposit with unexpected pubkey at block $block" >&2
    return 0
  fi
  if [[ ! "$credentials" =~ ^0x[0-9a-f]{64}$ ]]; then
    echo "Skipping deposit with unexpected credentials at block $block tx $txhash" >&2
    return 0
  fi
  if deposit_is_duplicate "$index" "$txhash" "$log_index"; then
    DUPLICATE_COUNT=$((DUPLICATE_COUNT + 1))
    return 0
  fi

  amount=$(format_bera "$amount_gwei")
  withdrawal_address=""
  prefix="${credentials:0:4}"
  if [[ "$prefix" == "0x01" || "$prefix" == "0x02" ]]; then
    withdrawal_address="0x${credentials:26:40}"
  fi

  from_address=""
  to_address=""
  if [[ "$txhash" != "genesis" ]]; then
    parties=$(tx_addresses "$txhash")
    from_address="${parties%%$'\t'*}"
    to_address="${parties#*$'\t'}"
  fi

  csv_row \
    "$date" \
    "$pubkey" \
    "$credentials" \
    "$withdrawal_address" \
    "$amount" \
    "$amount_gwei" \
    "$signature" \
    "$index" \
    "$block" \
    "$from_address" \
    "$to_address" \
    "$log_index" \
    "$txhash" \
    "$source"
  remember_deposit "$index" "$txhash" "$log_index"
  DEPOSIT_COUNT=$((DEPOSIT_COUNT + 1))
  echo "Deposit found: block $block  amount $amount BERA  pubkey $pubkey  tx $txhash  from ${from_address:--}" >&2
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
    echo "Error: $OUTPUT does not have the expected deposit CSV header" >&2
    exit 1
  fi
  if [[ -s "$OUTPUT" && -n "$(tail -c 1 "$OUTPUT")" ]]; then
    printf '\n' >> "$OUTPUT"
  fi
  load_seen_deposits
}

search_genesis() {
  local genesis_time pubkey credentials amount index signature
  local expected before captured

  if [[ ! -f "$GENESIS_FILE" ]]; then
    echo "Error: Genesis file not found: $GENESIS_FILE" >&2
    exit 1
  fi

  genesis_time=$(jq -r '.genesis_time // empty' "$GENESIS_FILE")
  if [[ -z "$genesis_time" ]]; then
    echo "Error: Genesis time missing in $GENESIS_FILE" >&2
    exit 1
  fi

  expected=$(jq '.app_state.beacon.deposits | length' "$GENESIS_FILE")
  if ! [[ "$expected" =~ ^[0-9]+$ ]]; then
    echo "Error: Could not read deposits from $GENESIS_FILE" >&2
    exit 1
  fi

  echo "Reading $expected genesis deposits from $GENESIS_FILE..." >&2
  before=$DEPOSIT_COUNT
  while IFS=$'\t' read -r pubkey credentials amount index signature; do
    [[ -n "$pubkey" ]] || continue
    amount=$(to_dec "$amount")
    append_deposit \
      "$genesis_time" \
      "$pubkey" \
      "$amount" \
      "genesis" \
      "$credentials" \
      "$index" \
      "$signature" \
      "0" \
      "" \
      "genesis"
  done < <(jq -r '
    .app_state.beacon.deposits[]
    | [
        .pubkey,
        .credentials,
        (.amount | tostring),
        (.index | tostring),
        .signature
      ]
    | @tsv
  ' "$GENESIS_FILE")

  captured=$((DEPOSIT_COUNT - before))
  if (( captured != expected )); then
    echo "Error: Wrote $captured of $expected genesis deposits from $GENESIS_FILE" >&2
    exit 1
  fi
  echo "Captured $captured genesis deposits from $GENESIS_FILE" >&2
}

search_logs() {
  local from="$1"
  local to="$2"
  local logs parsed err status
  local pubkey amount_hex credentials index_hex signature tx block log_index
  local amount_gwei index date

  echo "Scanning blocks $from to $to ($DEPOSIT_COUNT deposits so far)" >&2

  logs=$(run_with_retries "scanning blocks $from to $to" \
    cast logs \
    --rpc-url "$RPC_URL" \
    --address "$CONTRACT" \
    --from-block "$from" \
    --to-block "$to" \
    "$TOPIC" \
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
      | select((.data | length) >= 898)
      | (.data | ascii_downcase) as $d
      | {
          pubkey: ("0x" + $d[386:482]),
          amount: ("0x" + $d[178:194]),
          credentials: ("0x" + $d[578:642]),
          index: ("0x" + $d[306:322]),
          signature: ("0x" + $d[706:898]),
          tx: (.transactionHash // "" | ascii_downcase),
          block: (.blockNumber | hexdec),
          logIndex: ((.logIndex // "0x0") | hexdec)
        }
    ]
    | sort_by([.block, .logIndex])
    | .[]
    | [.pubkey, .amount, .credentials, .index, .signature, .tx, (.block | tostring), (.logIndex | tostring)]
    | @tsv
  ' 2>"$err")
  status=$?
  set -e
  if (( status != 0 )); then
    report_error "$status" "$err" "$logs"
  fi
  rm -f "$err"

  [[ -n "$parsed" ]] || return 0

  while IFS=$'\t' read -r pubkey amount_hex credentials index_hex signature tx block log_index; do
    [[ -n "$pubkey" ]] || continue
    amount_gwei=$(to_dec "$amount_hex")
    index=$(to_dec "$index_hex")
    date=$(block_date "$block")
    append_deposit \
      "$date" \
      "$pubkey" \
      "$amount_gwei" \
      "$tx" \
      "$credentials" \
      "$index" \
      "$signature" \
      "$block" \
      "$log_index" \
      "execution"
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

if (( APPEND )); then
  prepare_append
  echo "Appending deposits to: $OUTPUT" >&2
  echo "Ignoring genesis deposits" >&2
else
  write_header
  echo "Writing deposits to: $OUTPUT" >&2
  if (( INCLUDE_GENESIS )); then
    search_genesis
  fi
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

if [[ -f "$BLOCKS_FILE" ]]; then
  csv_max=0
  csv_max=$(awk '
    { gsub(/\r/, "") }
    $1 ~ /^[0-9]+$/ {
      b = $1 + 0
      if (b > max) max = b
    }
    END { print max + 0 }
  ' "$BLOCKS_FILE")

  in_range=()
  while IFS= read -r block; do
    [[ -n "$block" ]] || continue
    in_range+=("$block")
  done < <(awk -v start="$START_BLOCK" -v end="$END_BLOCK" '
    { gsub(/\r/, "") }
    $1 ~ /^[0-9]+$/ {
      b = $1 + 0
      if (b >= start && b <= end && b != 0) print b
    }
  ' "$BLOCKS_FILE" | sort -n | uniq)

  echo "Deposit block list: $BLOCKS_FILE (${#in_range[@]} blocks in range)" >&2

  i=0
  n=${#in_range[@]}
  while (( i < n )); do
    range_from=${in_range[$i]}
    range_to=$range_from
    limit=$((range_from + CHUNK_SIZE - 1))
    j=$i
    while (( j + 1 < n )); do
      next=$((j + 1))
      if (( in_range[next] > limit )); then
        break
      fi
      j=$next
      range_to=${in_range[$j]}
    done
    search_logs "$range_from" "$range_to"
    i=$((j + 1))
  done

  tail_from=$((csv_max + 1))
  if (( tail_from < START_BLOCK )); then
    tail_from=$START_BLOCK
  fi
  if (( tail_from <= END_BLOCK )); then
    scan_chunked "$tail_from"
  fi
else
  scan_chunked "$START_BLOCK"
fi

echo >&2
if (( APPEND )); then
  echo "Appended $DEPOSIT_COUNT deposits to $OUTPUT"
else
  echo "Wrote $DEPOSIT_COUNT deposits to $OUTPUT"
fi
if (( DUPLICATE_COUNT > 0 )); then
  echo "Skipped $DUPLICATE_COUNT duplicate deposits"
fi
