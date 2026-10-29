#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/allocations.sh [output.csv]
#
# Optional:
# VALIDATORS=./files/validators.csv ./scripts/allocations.sh
# RPC_URL=https://rpc.berachain.com ./scripts/allocations.sh ./files/allocations.csv
#
# The CSV is written to files/allocations.csv unless another path is given.
#
# Requires files/validators.csv from ./scripts/pubkeys.sh. Creates ./out when
# it is missing and, when out/vaults/mainnet.json is not already there,
# downloads the Berachain mainnet vault list:
# https://github.com/berachain/metadata/blob/main/src/vaults/mainnet.json
#
# One row per pubkey in files/validators.csv. name and operator_address are copied
# from that file. name is blank when that pubkey had no validator metadata.
# Each allocationN_* column is getActiveRewardAllocation(pubkey) on
# 0xdf960E8F3F19C481dDE769edEDD439ea1a63426a, for N from 1 to 10.
# allocationN_address is the reward vault. allocationN_name and
# allocationN_protocol come from the vault metadata for that address.
# They are blank when the address is missing or not in the metadata.
# allocationN_percentage_numerator is the raw weight. 10000 is 100%.
# Unused slots are 0.
# allocationN_percentage is that numerator divided by 100, so 3000 is
# stored as 30 and 1125 is stored as 11.25. Unused slots are blank.
#
# Values in .env at the repository root are used when the same variable is not already set.

RPC_URL_DEFAULT="https://rpc.berachain.com"
CONTRACT="0xdf960E8F3F19C481dDE769edEDD439ea1a63426a"
MULTICALL="0xcA11bde05977b3631167028862bE2a173976CA11"
VAULTS_URL="https://raw.githubusercontent.com/berachain/metadata/main/src/vaults/mainnet.json"
VALIDATORS_HEADER="name,pubkey,status,operator_address,withdrawal_address,stake,block_proposal,est_bera_24h,date_registration,date_active,date_exit"
MAX_SLOTS=10
MAX_ATTEMPTS=5
ALLOC_BATCH="${ALLOC_BATCH:-20}"

CSV_HEADER="name,pubkey,operator_address"
for ((slot = 1; slot <= MAX_SLOTS; slot++)); do
  CSV_HEADER="${CSV_HEADER},allocation${slot}_address,allocation${slot}_name,allocation${slot}_protocol,allocation${slot}_percentage_numerator,allocation${slot}_percentage"
done

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

OUTPUT_ARG=""
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      awk '
        NR == 1 { next }
        /^#/ { started = 1; sub(/^# ?/, ""); print; next }
        started { exit }
      ' "$0"
      exit 0
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

export LC_ALL=C

RPC_URL="${RPC_URL:-$RPC_URL_DEFAULT}"
VALIDATORS="${VALIDATORS:-$ROOT_DIR/files/validators.csv}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/out}"
VAULTS="${VAULTS:-$OUT_DIR/vaults/mainnet.json}"
OUTPUT="${OUTPUT_ARG:-${OUTPUT:-$ROOT_DIR/files/allocations.csv}}"
mkdir -p "$(dirname "$OUTPUT")"

if ! [[ "$ALLOC_BATCH" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: Invalid ALLOC_BATCH" >&2
  exit 1
fi

for cmd in cast jq curl awk; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is required" >&2
    exit 1
  fi
done

require_validators() {
  local actual
  if [[ ! -f "$VALIDATORS" ]]; then
    echo "Error: validators.csv not found: $VALIDATORS" >&2
    echo "Create files/validators.csv with ./scripts/pubkeys.sh before running ./scripts/allocations.sh." >&2
    exit 1
  fi
  if [[ ! -s "$VALIDATORS" ]]; then
    echo "Error: validators.csv is empty: $VALIDATORS" >&2
    exit 1
  fi
  actual=$(head -n 1 "$VALIDATORS" | tr -d '\r')
  if [[ "$actual" != "$VALIDATORS_HEADER" ]]; then
    echo "Error: $VALIDATORS does not have the expected validators.csv header" >&2
    exit 1
  fi
}

# Every field is quoted. Split on the quote-comma-quote between fields.
split_csv_row() {
  local line="$1" field
  line="${line%$'\r'}"
  line="${line#\"}"
  line="${line%\"}"
  CSV_FIELDS=()
  while IFS= read -r field || [[ -n "$field" ]]; do
    field="${field//\"\"/\"}"
    CSV_FIELDS+=("$field")
  done <<< "${line//\",\"/$'\n'}"
}

require_validators

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
    echo "Connection attempt $attempt/$MAX_ATTEMPTS failed: $description" >&2
    if [[ -s "$err" ]]; then
      cat "$err" >&2
    fi
    if (( attempt >= MAX_ATTEMPTS )); then
      rm -f "$err"
      exit 1
    fi
    echo "Retrying in $((attempt * 2))s..." >&2
    sleep $((attempt * 2))
    attempt=$((attempt + 1))
  done
}

vaults_ok() {
  jq -e '.vaults | type == "array" and length > 0' "$1" >/dev/null 2>&1
}

# The blob page is HTML, so the file is fetched from the raw URL.
ensure_vaults() {
  local dir partial
  dir=$(dirname "$VAULTS")
  partial="${VAULTS}.partial"
  mkdir -p "$OUT_DIR" "$dir"
  if [[ -f "$VAULTS" ]]; then
    if ! vaults_ok "$VAULTS"; then
      echo "Error: $VAULTS is not a vault metadata file" >&2
      exit 1
    fi
    echo "Using existing vault metadata: $VAULTS" >&2
    return 0
  fi

  echo "Downloading vault metadata..." >&2
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$partial" "$VAULTS_URL"; then
    rm -f "$partial"
    echo "Error: Failed to download $VAULTS_URL" >&2
    exit 1
  fi
  if ! vaults_ok "$partial"; then
    rm -f "$partial"
    echo "Error: Downloaded metadata is not a vault list" >&2
    exit 1
  fi
  mv "$partial" "$VAULTS"
  echo "Saved vault metadata to $VAULTS" >&2
}

read_validators() {
  local line first=1 name pk op
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if (( first )); then
      first=0
      continue
    fi
    [[ -n "$line" ]] || continue
    split_csv_row "$line"
    if (( ${#CSV_FIELDS[@]} < 4 )); then
      echo "Error: $VALIDATORS has a row with too few columns" >&2
      exit 1
    fi
    name="${CSV_FIELDS[0]}"
    pk=$(printf '%s' "${CSV_FIELDS[1]}" | tr '[:upper:]' '[:lower:]')
    op="${CSV_FIELDS[3]}"
    if ! [[ "$pk" =~ ^0x[0-9a-f]{96}$ ]]; then
      echo "Error: Invalid pubkey: $pk" >&2
      exit 1
    fi
    name=${name//$'\t'/ }
    name=${name//$'\r'/ }
    name=${name//$'\n'/ }
    op=${op//$'\t'/ }
    op=${op//$'\r'/ }
    op=${op//$'\n'/ }
    printf '%s\t%s\t%s\n' "$name" "$pk" "$op"
  done < "$VALIDATORS"
}

# pubkey, then address and numerator for slots 1..10.
# A numerator of "-" is an unused slot. Its address is empty.
decode_allocation() {
  local pk="$1" hex="$2" decoded pairs pair addr num addr_lower idx
  local -a slots_addr slots_num

  if ! decoded=$(cast abi-decode "getActiveRewardAllocation(bytes)((uint64,(address,uint96)[]))" "$hex" 2>"$TMP/decode.err"); then
    echo "Error: Could not decode reward allocation for $pk" >&2
    if [[ -s "$TMP/decode.err" ]]; then
      cat "$TMP/decode.err" >&2
    fi
    exit 1
  fi
  if [[ ! "$decoded" =~ \(.*\[ ]]; then
    echo "Error: Unexpected reward allocation result for $pk" >&2
    printf '%s\n' "$decoded" >&2
    exit 1
  fi

  pairs=$(printf '%s\n' "$decoded" | tr '\n' ' ' | grep -oE '0x[0-9a-fA-F]{40}, *[0-9]+' || true)

  for ((idx = 0; idx < MAX_SLOTS; idx++)); do
    slots_addr[$idx]=""
    slots_num[$idx]="-"
  done

  idx=0
  if [[ -n "$pairs" ]]; then
    while IFS= read -r pair || [[ -n "$pair" ]]; do
      [[ -n "$pair" ]] || continue
      if (( idx >= MAX_SLOTS )); then
        echo "Error: $pk has more than $MAX_SLOTS reward weights" >&2
        exit 1
      fi
      addr=${pair%%,*}
      num=${pair##*,}
      num=${num// /}
      if ! [[ "$num" =~ ^[0-9]+$ ]]; then
        echo "Error: Invalid weight for $pk: $pair" >&2
        exit 1
      fi
      addr_lower=$(printf '%s' "$addr" | tr '[:upper:]' '[:lower:]')
      if [[ "$addr_lower" == "0x0000000000000000000000000000000000000000" ]]; then
        addr=""
      fi
      slots_addr[$idx]="$addr"
      slots_num[$idx]="$num"
      idx=$((idx + 1))
    done <<< "$pairs"
  fi

  printf '%s' "$pk"
  for ((idx = 0; idx < MAX_SLOTS; idx++)); do
    printf '\t%s\t%s' "${slots_addr[$idx]}" "${slots_num[$idx]}"
  done
  printf '\n'
}

fetch_allocations() {
  local pubkey_file="$1"
  local out_file="$2"
  local -a pubkeys=()
  local -a slice=()
  local pk total start end i cd calls decoded count hex idx

  while IFS= read -r pk; do
    [[ -n "$pk" ]] || continue
    pubkeys+=("$pk")
  done < "$pubkey_file"

  total=${#pubkeys[@]}
  if (( total == 0 )); then
    echo "Error: No pubkeys to look up" >&2
    exit 1
  fi

  : > "$out_file"
  echo "Reading reward allocations for $total validators..." >&2
  start=0
  while (( start < total )); do
    end=$((start + ALLOC_BATCH))
    if (( end > total )); then end=$total; fi

    slice=()
    calls=""
    for ((i = start; i < end; i++)); do
      cd=$(cast calldata "getActiveRewardAllocation(bytes)" "${pubkeys[$i]}")
      cd=${cd//$'\n'/}
      slice+=("${pubkeys[$i]}")
      if [[ -n "$calls" ]]; then
        calls+=","
      fi
      calls+="($CONTRACT,true,$cd)"
    done

    decoded=$(run_with_retries "reading reward allocations" \
      cast call "$MULTICALL" \
      "aggregate3((address,bool,bytes)[])((bool,bytes)[])" \
      "[$calls]" \
      --rpc-url "$RPC_URL")

    if [[ "$decoded" == *"(false,"* ]]; then
      echo "Error: getActiveRewardAllocation failed" >&2
      exit 1
    fi

    printf '%s' "$decoded" | tr -d '[:space:]' | grep -oE '0x[0-9a-fA-F]+' > "$TMP/words"
    count=$(wc -l < "$TMP/words" | tr -d '[:space:]')
    if (( count != end - start )); then
      echo "Error: Expected $((end - start)) reward allocations, got $count" >&2
      exit 1
    fi

    idx=0
    while IFS= read -r hex || [[ -n "$hex" ]]; do
      [[ -n "$hex" ]] || continue
      decode_allocation "${slice[$idx]}" "$hex" >> "$out_file"
      idx=$((idx + 1))
    done < "$TMP/words"

    start=$end
    echo "Read allocations $end/$total" >&2
  done
}

write_allocations() {
  local validators="$1" allocations="$2" vaults="$3"
  awk -F'\t' -v slots="$MAX_SLOTS" '
    function q(s) { gsub(/"/, "\"\"", s); return "\"" s "\"" }
    function percentage(n,    whole, frac) {
      whole = int(n / 100)
      frac = n % 100
      if (frac == 0) return sprintf("%d", whole)
      if (frac % 10 == 0) return sprintf("%d.%d", whole, int(frac / 10))
      return sprintf("%d.%02d", whole, frac)
    }
    FNR == 1 { file++ }
    file == 1 {
      name[FNR] = $1
      pubkey[FNR] = $2
      operator[FNR] = $3
      rows = FNR
      next
    }
    file == 2 { alloc[$1] = $0; next }
    file == 3 {
      vault_name[$1] = $2
      vault_proto[$1] = $3
      next
    }
    END {
      expected = 1 + slots * 2
      for (i = 1; i <= rows; i++) {
        pk = pubkey[i]
        if (!(pk in alloc)) {
          printf "Error: Missing reward allocation for %s\n", pk > "/dev/stderr"
          exit 1
        }
        nf = split(alloc[pk], f, "\t")
        if (nf != expected || f[1] != pk) {
          printf "Error: Bad reward allocation row for %s\n", pk > "/dev/stderr"
          exit 1
        }
        line = q(name[i]) "," q(pk) "," q(operator[i])
        for (slot = 0; slot < slots; slot++) {
          addr = f[2 + slot * 2]
          num = f[3 + slot * 2]
          vname = ""
          vproto = ""
          pct = ""
          shown = "0"
          if (num != "-") {
            if (addr != "") {
              key = tolower(addr)
              vname = vault_name[key]
              vproto = vault_proto[key]
            }
            shown = num
            pct = percentage(num)
          }
          line = line "," q(addr) "," q(vname) "," q(vproto) "," q(shown) "," q(pct)
        }
        print line
      }
    }
  ' "$validators" "$allocations" "$vaults"
}

ensure_vaults

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Reading $VALIDATORS..." >&2
read_validators > "$TMP/validators.tsv"

if [[ ! -s "$TMP/validators.tsv" ]]; then
  echo "Error: No validators found in $VALIDATORS" >&2
  exit 1
fi

cut -f2 "$TMP/validators.tsv" > "$TMP/pubkeys.txt"
VALIDATOR_COUNT=$(wc -l < "$TMP/pubkeys.txt" | tr -d '[:space:]')

fetch_allocations "$TMP/pubkeys.txt" "$TMP/allocations.tsv"

ALLOC_COUNT=$(wc -l < "$TMP/allocations.tsv" | tr -d '[:space:]')
if [[ "$ALLOC_COUNT" != "$VALIDATOR_COUNT" ]]; then
  echo "Error: Reward allocation lookup returned $ALLOC_COUNT rows for $VALIDATOR_COUNT validators" >&2
  exit 1
fi

jq -r '
  .vaults[]?
  | (.vaultAddress // "" | ascii_downcase) as $raw
  | select($raw != "")
  | (if ($raw | startswith("0x")) then $raw else "0x" + $raw end) as $addr
  | [
      $addr,
      ((.name // "") | gsub("[\t\r\n]"; " ")),
      ((.protocol // "") | gsub("[\t\r\n]"; " "))
    ]
  | @tsv
' "$VAULTS" > "$TMP/vaults.tsv"

if [[ ! -s "$TMP/vaults.tsv" ]]; then
  echo "Error: No vaults found in $VAULTS" >&2
  exit 1
fi

echo "Writing $VALIDATOR_COUNT validators to $OUTPUT" >&2
{
  printf '%s\n' "$CSV_HEADER"
  write_allocations "$TMP/validators.tsv" "$TMP/allocations.tsv" "$TMP/vaults.tsv"
} > "$TMP/allocations.csv"

mv "$TMP/allocations.csv" "$OUTPUT"
echo "Wrote $VALIDATOR_COUNT validators to $OUTPUT" >&2
