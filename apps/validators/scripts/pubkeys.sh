#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/pubkeys.sh [output.csv]
# ./scripts/pubkeys.sh --append [output.csv]
#
# Optional:
# DEPOSITS=./files/deposits.csv EXITS=./files/exits.csv ./scripts/pubkeys.sh
# RPC_URL=https://rpc.berachain.com ./scripts/pubkeys.sh ./files/validators.csv
#
# The CSV is written to files/validators.csv unless another path is given.
#
# --append adds validators whose pubkey is not already in the CSV.
# A pubkey that is already listed is skipped, including a pubkey that
# appears more than once in the file. New rows use each validator's share
# of current total stake, including validators already in the file.
# Existing rows are left unchanged.
#
# Requires files/deposits.csv and files/exits.csv. Creates ./out when it is missing and,
# when out/mainnet.json is not already there, downloads the Berachain mainnet
# validator list:
# https://github.com/berachain/metadata/blob/main/src/validators/mainnet.json
#
# One row per pubkey in the deposits file. name comes from that metadata.
# operator_address is BeaconDeposit.getOperator(pubkey) on
# 0x4242424242424242424242424242424242424242.
# withdrawal_address comes from deposits.csv. A later deposit that leaves
# the address blank does not clear one already recorded for that pubkey.
# stake is BERA still deposited: deposits added, partial withdrawals
# subtracted, and a full exit set to 0. Consensus rewards are not included.
# block_proposal is that validator's share of total stake, as a percent with
# two decimal places.
# est_bera_24h is stake share times the on-chain baseRate times 43,200
# (one day of 2-second blocks), in BERA.
# date_registration is the first deposit. date_active is the first time
# stake reached 250,000 BERA.
# status is active when stake is at least 250,000 BERA, and inactive below that.
# date_exit is the date stake last fell below 250,000 BERA. It is blank while
# the validator is active, and blank if stake never reached 250,000 BERA.
#
# Values in .env at the repository root are used when the same variable is not already set.

RPC_URL_DEFAULT="https://rpc.berachain.com"
CONTRACT="0x4242424242424242424242424242424242424242"
REWARD_CONTROLLER="${REWARD_CONTROLLER:-0x1AE7dD7AE06F6C58B4524d9c1f816094B1bcCD8e}"
MULTICALL="0xcA11bde05977b3631167028862bE2a173976CA11"
METADATA_URL="https://raw.githubusercontent.com/berachain/metadata/main/src/validators/mainnet.json"
MIN_ACTIVE_BERA=250000
BLOCKS_PER_DAY=43200
MAX_ATTEMPTS=5
OPERATOR_BATCH=40

DEPOSITS_HEADER="date,pubkey,withdrawal_credentials,withdrawal_address,amount,amount_gwei,signature,index,block_number,from,to,log_index,txhash,source"
EXITS_HEADER="date,pubkey,withdrawal_address,amount,amount_gwei,block_number,from,to,log_index,txhash,request_type,index"
CSV_HEADER="name,pubkey,status,operator_address,withdrawal_address,stake,block_proposal,est_bera_24h,date_registration,date_active,date_exit"

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
DEPOSITS="${DEPOSITS:-$ROOT_DIR/files/deposits.csv}"
EXITS="${EXITS:-$ROOT_DIR/files/exits.csv}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/out}"
METADATA="${METADATA:-$OUT_DIR/validators/mainnet.json}"
OUTPUT="${OUTPUT_ARG:-${OUTPUT:-$ROOT_DIR/files/validators.csv}}"
mkdir -p "$(dirname "$OUTPUT")"

for cmd in cast jq curl awk sort cut; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is required" >&2
    exit 1
  fi
done

require_csv() {
  local file="$1" label="$2" header="$3" actual
  if [[ ! -f "$file" ]]; then
    echo "Error: $label not found: $file" >&2
    echo "Create $label before running scripts/pubkeys.sh." >&2
    exit 1
  fi
  if [[ ! -s "$file" ]]; then
    echo "Error: $label is empty: $file" >&2
    exit 1
  fi
  actual=$(head -n 1 "$file" | tr -d '\r')
  if [[ "$actual" != "$header" ]]; then
    echo "Error: $file does not have the expected $label header" >&2
    exit 1
  fi
}

require_csv "$DEPOSITS" "deposits.csv" "$DEPOSITS_HEADER"
require_csv "$EXITS" "exits.csv" "$EXITS_HEADER"

require_append_output() {
  local header
  if [[ ! -f "$OUTPUT" ]]; then
    echo "Error: CSV not found: $OUTPUT" >&2
    exit 1
  fi
  header=$(head -n 1 "$OUTPUT" | tr -d '\r')
  if [[ "$header" != "$CSV_HEADER" ]]; then
    echo "Error: $OUTPUT does not have the expected validator CSV header" >&2
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

load_seen_validators() {
  local line pk
  SEEN_COUNT=0
  DUPLICATE_EXISTING=0
  mkdir -p "$TMP/seen"
  : > "$TMP/seen-pubkeys.txt"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -n "$line" ]] || continue
    split_csv_row "$line"
    if (( ${#CSV_FIELDS[@]} < 2 )); then
      echo "Error: $OUTPUT has a row with too few columns" >&2
      exit 1
    fi
    pk=$(printf '%s' "${CSV_FIELDS[1]}" | tr '[:upper:]' '[:lower:]')
    if [[ -z "$pk" ]]; then
      echo "Error: $OUTPUT has a row without a pubkey" >&2
      exit 1
    fi
    if [[ -e "$TMP/seen/$pk" ]]; then
      DUPLICATE_EXISTING=$((DUPLICATE_EXISTING + 1))
      continue
    fi
    : > "$TMP/seen/$pk"
    printf '%s\n' "$pk" >> "$TMP/seen-pubkeys.txt"
    SEEN_COUNT=$((SEEN_COUNT + 1))
  done < <(tail -n +2 "$OUTPUT")
  echo "Existing validators: $SEEN_COUNT" >&2
  if (( DUPLICATE_EXISTING == 1 )); then
    echo "Found 1 duplicate pubkey row already in $OUTPUT" >&2
  elif (( DUPLICATE_EXISTING > 1 )); then
    echo "Found $DUPLICATE_EXISTING duplicate pubkey rows already in $OUTPUT" >&2
  fi
}

prepare_append() {
  require_append_output
  if [[ -s "$OUTPUT" && -n "$(tail -c 1 "$OUTPUT")" ]]; then
    printf '\n' >> "$OUTPUT"
  fi
  load_seen_validators
}

if (( APPEND )); then
  require_append_output
fi

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

metadata_ok() {
  jq -e '.validators | type == "array"' "$1" >/dev/null 2>&1
}

ensure_metadata() {
  local partial="$OUT_DIR/validators/mainnet.json.partial"
  mkdir -p "$OUT_DIR"
  if [[ -f "$METADATA" ]]; then
    if ! metadata_ok "$METADATA"; then
      echo "Error: $METADATA is not a validator metadata file" >&2
      exit 1
    fi
    echo "Using existing metadata: $METADATA" >&2
    return 0
  fi

  echo "Downloading validator metadata..." >&2
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$partial" "$METADATA_URL"; then
    rm -f "$partial"
    echo "Error: Failed to download $METADATA_URL" >&2
    exit 1
  fi
  if ! metadata_ok "$partial"; then
    rm -f "$partial"
    echo "Error: Downloaded metadata is not a validator list" >&2
    exit 1
  fi
  mv "$partial" "$METADATA"
  echo "Saved metadata to $METADATA" >&2
}

# pubkey, stake, gwei, date_registration, date_active, date_exit, withdrawal_address
collect_stakes() {
  awk -F',' '
    function unquote(v) {
      gsub(/\r/, "", v)
      gsub(/^"|"$/, "", v)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      return v
    }
    function col(name,    i) {
      i = cols[name]
      if (i == 0) {
        printf "Error: %s is missing column %s\n", FILENAME, name > "/dev/stderr"
        exit 1
      }
      return unquote($i)
    }
    FNR == 1 {
      delete cols
      for (i = 1; i <= NF; i++) cols[unquote($i)] = i
      if (cols["request_type"] > 0) kind = "exit"
      else kind = "deposit"
      next
    }
    {
      pk = tolower(col("pubkey"))
      if (pk == "") next
      block = col("block_number") + 0
      logi = col("log_index")
      if (logi == "") logi = 0
      if (kind == "deposit") rank = 0
      else rank = 1
      printf "%s\t%d\t%d\t%d\t%s\t%s\t%s\t%s\n", col("date"), block, logi + 0, rank, pk, col("amount"), (kind == "exit" ? col("request_type") : ""), (kind == "deposit" ? col("withdrawal_address") : "")
    }
  ' "$DEPOSITS" "$EXITS" | sort -t $'\t' -k1,1 -k2,2n -k3,3n -k4,4n | awk -F'\t' -v min_gwei="g${MIN_ACTIVE_BERA}000000000" '
    function strip(s) { sub(/^0+/, "", s); return s == "" ? "0" : s }
    function cmp(a, b,    sa, sb) {
      a = strip(a); b = strip(b)
      sa = length(a); sb = length(b)
      if (sa != sb) return sa < sb ? -1 : 1
      return a == b ? 0 : (a < b ? -1 : 1)
    }
    function add(a, b,    i, carry, sum, out, t) {
      a = strip(a); b = strip(b)
      if (length(a) < length(b)) { t = a; a = b; b = t }
      while (length(b) < length(a)) b = "0" b
      carry = 0; out = ""
      for (i = length(a); i >= 1; i--) {
        sum = substr(a, i, 1) + substr(b, i, 1) + carry
        carry = int(sum / 10)
        out = (sum % 10) out
      }
      if (carry) out = carry out
      return strip(out)
    }
    function minus(a, b,    i, borrow, da, db, out) {
      a = strip(a); b = strip(b)
      while (length(b) < length(a)) b = "0" b
      borrow = 0; out = ""
      for (i = length(a); i >= 1; i--) {
        da = substr(a, i, 1) - borrow
        db = substr(b, i, 1) + 0
        if (da < db) { da += 10; borrow = 1 } else borrow = 0
        out = (da - db) out
      }
      return strip(out)
    }
    function to_gwei(amount,    parts, whole, frac) {
      split(amount, parts, ".")
      whole = parts[1]
      frac = parts[2]
      gsub(/[^0-9]/, "", whole)
      gsub(/[^0-9]/, "", frac)
      if (whole == "") whole = "0"
      if (length(frac) > 9) frac = substr(frac, 1, 9)
      while (length(frac) < 9) frac = frac "0"
      return strip(whole frac)
    }
    function gwei_to_bera(g,    whole, frac) {
      g = strip(g)
      if (g == "0") return "0"
      if (length(g) <= 9) {
        frac = g
        while (length(frac) < 9) frac = "0" frac
        sub(/0+$/, "", frac)
        if (frac == "") return "0"
        return "0." frac
      }
      whole = substr(g, 1, length(g) - 9)
      frac = substr(g, length(g) - 8)
      sub(/0+$/, "", frac)
      if (frac == "") return whole
      return whole "." frac
    }
    BEGIN { sub(/^g/, "", min_gwei); min_gwei = strip(min_gwei) }
    {
      pk = $5
      if (!(pk in balance)) balance[pk] = "0"
      prev = balance[pk]
      if ($4 == 0) {
        if (!(pk in registered)) registered[pk] = $1
        if ($8 != "") withdrawal[pk] = $8
        balance[pk] = add(balance[pk], to_gwei($6))
        deposited[pk] = 1
      } else if ($7 == "Full exit") {
        balance[pk] = "0"
      } else {
        g = to_gwei($6)
        if (cmp(balance[pk], g) < 0) balance[pk] = "0"
        else balance[pk] = minus(balance[pk], g)
      }
      if (deposited[pk] && cmp(balance[pk], min_gwei) >= 0) {
        if (!(pk in active)) active[pk] = $1
        exit_date[pk] = ""
      } else if (deposited[pk] && cmp(prev, min_gwei) >= 0 && cmp(balance[pk], min_gwei) < 0) {
        exit_date[pk] = $1
      }
    }
    END {
      for (pk in deposited) {
        printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", pk, gwei_to_bera(balance[pk]), balance[pk], registered[pk], active[pk], exit_date[pk], withdrawal[pk]
      }
    }
  '
}

fetch_base_rate() {
  local raw
  echo "Reading baseRate..." >&2
  raw=$(run_with_retries "reading baseRate" \
    cast call "$REWARD_CONTROLLER" "baseRate()(uint256)" --rpc-url "$RPC_URL")
  raw=${raw%%[[:space:]]*}
  if ! [[ "$raw" =~ ^[0-9]+$ ]]; then
    echo "Error: baseRate was not a number: $raw" >&2
    exit 1
  fi
  printf '%s\n' "$raw"
}

fetch_operators() {
  local pubkey_file="$1"
  local out_file="$2"
  local -a pubkeys=()
  local -a slice=()
  local pk total start end i cd calls decoded count idx word addr

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
  echo "Reading operator addresses for $total validators..." >&2
  start=0
  while (( start < total )); do
    end=$((start + OPERATOR_BATCH))
    if (( end > total )); then end=$total; fi

    slice=()
    calls=""
    for (( i = start; i < end; i++ )); do
      cd=$(cast calldata "getOperator(bytes)" "${pubkeys[$i]}")
      cd=${cd//$'\n'/}
      slice+=("${pubkeys[$i]}")
      if [[ -n "$calls" ]]; then
        calls+=","
      fi
      calls+="($CONTRACT,true,$cd)"
    done

    decoded=$(run_with_retries "reading operator addresses" \
      cast call "$MULTICALL" \
      "aggregate3((address,bool,bytes)[])((bool,bytes)[])" \
      "[$calls]" \
      --rpc-url "$RPC_URL")

    if [[ "$decoded" == *"(false,"* ]]; then
      echo "Error: BeaconDeposit.getOperator failed" >&2
      exit 1
    fi

    printf '%s\n' "$decoded" | grep -oE '0x[0-9a-fA-F]{64}' > "$TMP/words"
    count=$(wc -l < "$TMP/words" | tr -d '[:space:]')
    if (( count != end - start )); then
      echo "Error: Expected $((end - start)) operator results, got $count" >&2
      exit 1
    fi

    idx=0
    while IFS= read -r word; do
      addr=$(cast to-check-sum-address "0x${word:26:40}")
      printf '%s\t%s\n' "${slice[$idx]}" "$addr" >> "$out_file"
      idx=$((idx + 1))
    done < "$TMP/words"

    start=$end
    echo "Read operators $end/$total" >&2
  done
}

write_validators() {
  local stakes="$1" operators="$2" names="$3" base_wei="$4" seen="${5:-}"
  local -a files=("$stakes" "$operators" "$names")
  if [[ -n "$seen" ]]; then
    files+=("$seen")
  fi
  awk -F'\t' -v base_wei="b${base_wei}" -v blocks="$BLOCKS_PER_DAY" -v min_gwei="g${MIN_ACTIVE_BERA}000000000" '
    function strip(s) { sub(/^0+/, "", s); return s == "" ? "0" : s }
    function cmp(a, b,    sa, sb) {
      a = strip(a); b = strip(b)
      sa = length(a); sb = length(b)
      if (sa != sb) return sa < sb ? -1 : 1
      return a == b ? 0 : (a < b ? -1 : 1)
    }
    function add(a, b,    i, carry, sum, out, t) {
      a = strip(a); b = strip(b)
      if (length(a) < length(b)) { t = a; a = b; b = t }
      while (length(b) < length(a)) b = "0" b
      carry = 0; out = ""
      for (i = length(a); i >= 1; i--) {
        sum = substr(a, i, 1) + substr(b, i, 1) + carry
        carry = int(sum / 10)
        out = (sum % 10) out
      }
      if (carry) out = carry out
      return strip(out)
    }
    function minus(a, b,    i, borrow, da, db, out) {
      a = strip(a); b = strip(b)
      while (length(b) < length(a)) b = "0" b
      borrow = 0; out = ""
      for (i = length(a); i >= 1; i--) {
        da = substr(a, i, 1) - borrow
        db = substr(b, i, 1) + 0
        if (da < db) { da += 10; borrow = 1 } else borrow = 0
        out = (da - db) out
      }
      return strip(out)
    }
    function mul(a, b,    i, j, n, m, da, db, carry, out, k) {
      a = strip(a); b = strip(b)
      if (a == "0" || b == "0") return "0"
      n = length(a); m = length(b)
      delete dig
      for (i = 0; i < n + m + 2; i++) dig[i] = 0
      for (i = 1; i <= n; i++) {
        da = substr(a, n - i + 1, 1) + 0
        for (j = 1; j <= m; j++) {
          db = substr(b, m - j + 1, 1) + 0
          dig[i + j - 2] += da * db
        }
      }
      carry = 0
      for (k = 0; k < n + m + 2; k++) {
        dig[k] += carry
        carry = int(dig[k] / 10)
        dig[k] = dig[k] % 10
      }
      while (carry > 0) {
        dig[k] = carry % 10
        carry = int(carry / 10)
        k++
      }
      out = ""
      for (i = k - 1; i >= 0; i--) out = out dig[i]
      return strip(out)
    }
    function div_round(num, den,    n, i, rem, q, lo, hi, mid, digit, prod) {
      num = strip(num); den = strip(den)
      if (den == "0" || num == "0") return "0"
      q = ""; rem = "0"; n = length(num)
      for (i = 1; i <= n; i++) {
        rem = strip(rem substr(num, i, 1))
        lo = 0; hi = 9; digit = 0
        while (lo <= hi) {
          mid = int((lo + hi) / 2)
          prod = mid == 0 ? "0" : mul(den, mid "")
          if (cmp(prod, rem) <= 0) { digit = mid; lo = mid + 1 } else hi = mid - 1
        }
        q = q digit
        if (digit > 0) rem = minus(rem, mul(den, digit ""))
      }
      q = strip(q)
      if (cmp(add(rem, rem), den) >= 0) q = add(q, "1")
      return q
    }
    function fixed2(hundredths,    s, whole, frac) {
      s = strip(hundredths)
      while (length(s) < 3) s = "0" s
      whole = substr(s, 1, length(s) - 2)
      frac = substr(s, length(s) - 1, 2)
      if (whole == "") whole = "0"
      return whole "." frac
    }
    function pad(s, width) {
      s = strip(s)
      while (length(s) < width) s = "0" s
      return s
    }
    function q(s) { gsub(/"/, "\"\"", s); return "\"" s "\"" }
    BEGIN {
      sub(/^b/, "", base_wei); base_wei = strip(base_wei); blocks = blocks ""
      sub(/^g/, "", min_gwei); min_gwei = strip(min_gwei)
    }
    FNR == 1 { file++ }
    file == 1 {
      display[$1] = $2
      gwei[$1] = $3
      registered[$1] = $4
      active[$1] = $5
      exit_date[$1] = $6
      withdrawal[$1] = $7
      order[++n] = $1
      next
    }
    file == 2 { operator[$1] = $2; next }
    file == 3 { name[tolower($1)] = $2; next }
    file == 4 { seen[$1] = 1; next }
    END {
      total = "0"
      for (i = 1; i <= n; i++) total = add(total, gwei[order[i]])
      for (i = 1; i <= n; i++) {
        pk = order[i]
        if (seen[pk]) continue
        if (total == "0" || gwei[pk] == "0") {
          pct = "0.00%"
          est = "0.00"
        } else {
          pct = fixed2(div_round(mul(gwei[pk], "10000"), total)) "%"
          den = mul(total, "1000000000000000000")
          num = mul(mul(mul(gwei[pk], base_wei), blocks), "100")
          est = fixed2(div_round(num, den))
        }
        if (cmp(gwei[pk], min_gwei) >= 0) {
          status = "active"
          exited = ""
        } else {
          status = "inactive"
          exited = exit_date[pk]
        }
        line = q(name[pk]) "," q(pk) "," q(status) "," q(operator[pk]) "," q(withdrawal[pk]) "," q(display[pk]) "," q(pct) "," q(est) "," q(registered[pk]) "," q(active[pk]) "," q(exited)
        printf "%s\t%s\t%s\n", pad(gwei[pk], 40), pk, line
      }
    }
  ' "${files[@]}" | sort -t $'\t' -k1,1r -k2,2 | cut -f3-
}

ensure_metadata

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Reading deposits and exits..." >&2
collect_stakes > "$TMP/stakes.tsv"

if [[ ! -s "$TMP/stakes.tsv" ]]; then
  echo "Error: No validator pubkeys found in $DEPOSITS" >&2
  exit 1
fi

cut -f1 "$TMP/stakes.tsv" > "$TMP/pubkeys.txt"
SEEN_FILE=""
if (( APPEND )); then
  prepare_append
  : > "$TMP/new-stakes.tsv"
  NEW_COUNT=0
  DUPLICATE_COUNT=0
  while IFS=$'\t' read -r pk display gwei reg active exited withdrawal || [[ -n "${pk:-}" ]]; do
    [[ -n "$pk" ]] || continue
    if [[ -e "$TMP/seen/$pk" ]]; then
      DUPLICATE_COUNT=$((DUPLICATE_COUNT + 1))
      continue
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pk" "$display" "$gwei" "$reg" "$active" "$exited" "$withdrawal" >> "$TMP/new-stakes.tsv"
    NEW_COUNT=$((NEW_COUNT + 1))
  done < "$TMP/stakes.tsv"

  if (( NEW_COUNT == 0 )); then
    echo "Appended 0 validators to $OUTPUT" >&2
    if (( DUPLICATE_COUNT == 1 )); then
      echo "Skipped 1 duplicate validator" >&2
    else
      echo "Skipped $DUPLICATE_COUNT duplicate validators" >&2
    fi
    exit 0
  fi
  cut -f1 "$TMP/new-stakes.tsv" > "$TMP/pubkeys.txt"
  SEEN_FILE="$TMP/seen-pubkeys.txt"
  if (( NEW_COUNT == 1 )); then
    echo "Appending 1 validator to $OUTPUT" >&2
  else
    echo "Appending $NEW_COUNT validators to $OUTPUT" >&2
  fi
fi

VALIDATOR_COUNT=$(wc -l < "$TMP/pubkeys.txt" | tr -d '[:space:]')

BASE_WEI=$(fetch_base_rate)
fetch_operators "$TMP/pubkeys.txt" "$TMP/operators.tsv"

jq -r '
  .validators[]?
  | (.id // "" | ascii_downcase) as $id
  | select($id != "")
  | (if ($id | startswith("0x")) then $id else "0x" + $id end) as $pk
  | [$pk, ((.name // "") | gsub("[\t\r\n]"; " "))]
  | @tsv
' "$METADATA" > "$TMP/names.tsv"

OP_COUNT=$(wc -l < "$TMP/operators.tsv" | tr -d '[:space:]')
if [[ "$OP_COUNT" != "$VALIDATOR_COUNT" ]]; then
  echo "Error: Operator lookup returned $OP_COUNT rows for $VALIDATOR_COUNT validators" >&2
  exit 1
fi

if (( APPEND )); then
  write_validators "$TMP/stakes.tsv" "$TMP/operators.tsv" "$TMP/names.tsv" "$BASE_WEI" "$SEEN_FILE" >> "$OUTPUT"
  if (( NEW_COUNT == 1 )); then
    echo "Appended 1 validator to $OUTPUT" >&2
  else
    echo "Appended $NEW_COUNT validators to $OUTPUT" >&2
  fi
  if (( DUPLICATE_COUNT == 1 )); then
    echo "Skipped 1 duplicate validator" >&2
  else
    echo "Skipped $DUPLICATE_COUNT duplicate validators" >&2
  fi
else
  echo "Writing $VALIDATOR_COUNT validators to $OUTPUT" >&2
  {
    printf '%s\n' "$CSV_HEADER"
    write_validators "$TMP/stakes.tsv" "$TMP/operators.tsv" "$TMP/names.tsv" "$BASE_WEI"
  } > "$TMP/validators.csv"
  mv "$TMP/validators.csv" "$OUTPUT"
  echo "Wrote $VALIDATOR_COUNT validators to $OUTPUT" >&2
fi
