#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/validator.sh --pubkey 0x<validator_pubkey>
# ./scripts/validator.sh --pubkey 0x<validator_pubkey> --output
# ./scripts/validator.sh --pubkey 0x<validator_pubkey> --output ./files/custom.csv
#
# Optional:
# DEPOSITS=./files/deposits.csv EXITS=./files/exits.csv VALIDATORS=./files/validators.csv ./scripts/validator.sh --pubkey 0x...
#
# --output writes a CSV of the same deposit and exit rows, with the summary and
# status repeated on each row. With no path, the file is files/<pubkey>.csv.
# --output <path> and --output=<path> choose another file.
# Amounts in the CSV are BERA with no thousands separators.
# total_deposit_txns_excluding_genesis omits genesis deposits.
# An empty from, or a blank status date, is an empty cell.
#
# Reads files/deposits.csv, files/exits.csv, and files/validators.csv and prints
# every deposit and exit row for that validator, plus its status.
# Deposit rows use type "deposit". Exit rows use the request type from
# exits.csv: "Full exit" or "Partial withdrawal".
# from is the wallet that sent the transaction. Genesis rows have an empty from.
# Remaining stake is total deposits minus partial withdrawals. A full exit
# withdraws the rest, so remaining stake is 0.
# Status comes from validators.csv. current status is active or inactive.
# date_exit is blank while the validator is active. Blank dates print as "-".

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
DEPOSITS="${DEPOSITS:-$ROOT_DIR/files/deposits.csv}"
EXITS="${EXITS:-$ROOT_DIR/files/exits.csv}"
VALIDATORS="${VALIDATORS:-$ROOT_DIR/files/validators.csv}"
PUBKEY=""
WRITE_CSV=0
OUTPUT=""

usage() {
  cat >&2 <<EOF
Usage: $0 --pubkey 0x<validator_pubkey> [--output [csv]]

  --output writes a CSV of the results. With no path, the file is
  files/<pubkey>.csv. Pass a path after --output, or use --output=<path>,
  to choose another file.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pubkey)
      if [[ $# -lt 2 || -z "${2:-}" || "$2" == --* ]]; then
        echo "Error: --pubkey requires a value" >&2
        usage
        exit 1
      fi
      PUBKEY="$2"
      shift 2
      ;;
    --pubkey=*)
      PUBKEY="${1#*=}"
      shift
      ;;
    --output)
      WRITE_CSV=1
      if [[ $# -ge 2 && -n "${2:-}" && "$2" != --* ]]; then
        OUTPUT="$2"
        shift 2
      else
        shift
      fi
      ;;
    --output=*)
      WRITE_CSV=1
      OUTPUT="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PUBKEY" ]]; then
  usage
  exit 1
fi

PUBKEY="0x$(printf '%s' "${PUBKEY#0x}" | tr '[:upper:]' '[:lower:]')"

if ! [[ "$PUBKEY" =~ ^0x[0-9a-f]{96}$ ]]; then
  echo "Error: Expected a 48-byte validator pubkey" >&2
  exit 1
fi

if [[ ! -f "$DEPOSITS" ]]; then
  echo "Error: Deposits file not found: $DEPOSITS" >&2
  exit 1
fi

if [[ ! -f "$EXITS" ]]; then
  echo "Error: Exits file not found: $EXITS" >&2
  exit 1
fi

if [[ ! -f "$VALIDATORS" ]]; then
  echo "Error: Validators file not found: $VALIDATORS" >&2
  exit 1
fi

read_rows() {
  local file="$1"
  local kind="$2"
  awk -F',' -v pubkey="$PUBKEY" -v kind="$kind" '
    function unquote(value) {
      gsub(/^"|"$/, "", value)
      return value
    }
    function field(name,   i) {
      i = cols[name]
      if (i == 0) {
        printf "Error: %s is missing column %s\n", FILENAME, name > "/dev/stderr"
        exit 1
      }
      return unquote($i)
    }
    NR == 1 {
      for (i = 1; i <= NF; i++) cols[unquote($i)] = i
      next
    }
    {
      row_pubkey = tolower(field("pubkey"))
      if (row_pubkey != pubkey) next
      if (kind == "deposit") type = "deposit"
      else {
        type = field("request_type")
        if (type == "") type = "exit"
      }
      from = field("from")
      if (from == "") from = "-"
      printf "%s\t%s\t%s\t%s\t%s\n", field("date"), type, field("amount"), from, field("txhash")
    }
  ' "$file"
}

matches=$(read_rows "$DEPOSITS" deposit)
exits=$(read_rows "$EXITS" exit)

if [[ -z "$matches" ]]; then
  echo "No deposits found for $PUBKEY"
  exit 1
fi

format_amount() {
  awk -v n="$1" '
    BEGIN {
      sign = ""
      if (n ~ /^-/) {
        sign = "-"
        n = substr(n, 2)
      }
      if (index(n, ".") > 0) {
        sub(/0+$/, "", n)
        sub(/\.$/, "", n)
      }
      split(n, parts, ".")
      intpart = parts[1]
      frac = parts[2]
      if (intpart == "") intpart = "0"
      sub(/^0+/, "", intpart)
      if (intpart == "") intpart = "0"
      out = ""
      len = length(intpart)
      for (i = 1; i <= len; i++) {
        if (i > 1 && (len - i + 1) % 3 == 0) out = out ","
        out = out substr(intpart, i, 1)
      }
      if (frac != "") printf "%s%s.%s\n", sign, out, frac
      else printf "%s%s\n", sign, out
    }
  '
}

read -r genesis_count deposit_count <<EOF
$(printf '%s\n' "$matches" | awk -F'\t' '
  $2 == "deposit" && $5 == "genesis" { genesis++ }
  $2 == "deposit" && $5 != "genesis" { deposit++ }
  END { print genesis+0, deposit+0 }
')
EOF

deposit_sum=$(printf '%s\n' "$matches" | awk -F'\t' '$2 == "deposit" { print $3 }' | paste -sd+ -)
if [[ -z "$deposit_sum" ]]; then
  deposit_sum=0
else
  deposit_sum=$(bc <<< "$deposit_sum")
fi
deposit_total=$(format_amount "$deposit_sum")

exit_count=0
full_exit=0
exit_sum=0
if [[ -n "$exits" ]]; then
  exit_count=$(printf '%s\n' "$exits" | awk -F'\t' 'NF { c++ } END { print c+0 }')
  if printf '%s\n' "$exits" | awk -F'\t' '$2 == "Full exit" { found = 1 } END { exit !found }'; then
    full_exit=1
  fi
  exit_expr=$(printf '%s\n' "$exits" | awk -F'\t' 'NF { print $3 }' | paste -sd+ -)
  if [[ -n "$exit_expr" ]]; then
    exit_sum=$(bc <<< "$exit_expr")
  fi
fi
exit_total=$(format_amount "$exit_sum")

if (( full_exit )); then
  remaining_raw=0
else
  remaining_raw=$(bc <<< "scale=18; $deposit_sum - ($exit_sum)")
  if [[ "$remaining_raw" == -* ]]; then
    remaining_raw=0
  fi
fi
remaining=$(format_amount "$remaining_raw")

# validators.csv data rows are fully quoted. Names can contain commas, so split
# on the quote-comma-quote between fields instead of on every comma.
status_row=$(awk -v pubkey="$PUBKEY" '
  function unquote(value) {
    gsub(/""/, "\"", value)
    return value
  }
  function dash(value) {
    if (value == "") return "-"
    return value
  }
  NR == 1 {
    sub(/\r$/, "")
    n = split($0, header, ",")
    for (i = 1; i <= n; i++) cols[header[i]] = i
    split("pubkey,status,date_registration,date_active,date_exit", required, ",")
    for (i = 1; i <= 5; i++) {
      if (cols[required[i]] == 0) {
        printf "Error: %s is missing column %s\n", FILENAME, required[i] > "/dev/stderr"
        bad = 1
        exit 1
      }
    }
    next
  }
  {
    line = $0
    sub(/\r$/, "", line)
    sub(/^"/, "", line)
    sub(/"$/, "", line)
    n = split(line, parts, "\",\"")
    row_pubkey = tolower(unquote(parts[cols["pubkey"]]))
    if (row_pubkey != pubkey) next
    printf "%s\t%s\t%s\t%s\n",
      dash(unquote(parts[cols["status"]])),
      dash(unquote(parts[cols["date_registration"]])),
      dash(unquote(parts[cols["date_active"]])),
      dash(unquote(parts[cols["date_exit"]]))
    found = 1
    exit
  }
  END {
    if (bad) exit 1
    if (!found) print "-\t-\t-\t-"
  }
' "$VALIDATORS") || exit 1

IFS=$'\t' read -r current_status date_registered date_active date_exit <<< "$status_row"
if [[ "$current_status" == "-" && "$date_registered" == "-" ]]; then
  echo "Warning: $PUBKEY was not found in $VALIDATORS" >&2
fi

print_txns() {
  local rows="$1"
  printf '%-4s %-22s %-20s %-20s %-42s %s\n' "#" "DATE" "TYPE" "AMOUNT" "FROM" "TXHASH"
  if [[ -z "$rows" ]]; then
    return
  fi
  local n=0
  printf '%s\n' "$rows" | while IFS=$'\t' read -r date type amount from txhash; do
    n=$((n + 1))
    printf '%-4s %-22s %-20s %-20s %-42s %s\n' "$n" "$date" "$type" "$amount" "$from" "$txhash"
  done
}

rule=$(printf '=%.0s' {1..80})

printf '%s\n' "$rule"
printf 'PUBKEY:\n%s\n' "$PUBKEY"
printf '%s\n' "$rule"
echo "DEPOSIT TXNs:"
print_txns "$matches"
printf '%s\n' "$rule"
echo "EXIT TXNs:"
print_txns "$exits"
printf '%s\n' "$rule"
echo "SUMMARY"
printf '| %-39s | %s |\n' "TOTAL_GENESIS_TXNS" "$genesis_count"
printf '| %-39s | %s |\n' "TOTAL_DEPOSIT_TXNS (excluding genesis)" "$deposit_count"
printf '| %-39s | %s BERA |\n' "TOTAL_DEPOSIT" "$deposit_total"
printf '| %-39s | %s |\n' "TOTAL_EXIT_TXNS" "$exit_count"
printf '| %-39s | %s BERA |\n' "TOTAL_EXIT" "$exit_total"
printf '| %-39s | %s BERA |\n' "TOTAL_REMAINING_STAKE" "$remaining"
printf '%s\n' "$rule"
echo "STATUS"
printf '%s\n' "$rule"
printf '| %-39s | %s |\n' "CURRENT_STATUS" "$current_status"
printf '| %-39s | %s |\n' "DATE_REGISTERED" "$date_registered"
printf '| %-39s | %s |\n' "DATE_ACTIVE" "$date_active"
printf '| %-39s | %s |\n' "DATE_EXIT" "$date_exit"

if (( WRITE_CSV )); then
  if [[ -z "$OUTPUT" ]]; then
    OUTPUT="$ROOT_DIR/files/${PUBKEY}.csv"
  fi
  mkdir -p "$(dirname "$OUTPUT")"

  csv_quote() {
    local value="$1"
    value=${value//\"/\"\"}
    printf '"%s"' "$value"
  }

  # Display uses "-" for an empty from or a blank status date. The CSV leaves
  # those cells empty, matching the other files in files/.
  blank_dash() {
    if [[ "$1" == "-" ]]; then
      printf ''
    else
      printf '%s' "$1"
    fi
  }

  # bc scale=18 leaves trailing zeros. The CSV stores the same trimmed number
  # the report shows, without the thousands separators.
  trim_decimal() {
    awk -v n="$1" 'BEGIN {
      sign = ""
      if (n ~ /^-/) {
        sign = "-"
        n = substr(n, 2)
      }
      if (index(n, ".") > 0) {
        sub(/0+$/, "", n)
        sub(/\.$/, "", n)
      }
      if (n ~ /^\./) n = "0" n
      if (n == "" || n == ".") n = "0"
      printf "%s%s\n", sign, n
    }'
  }

  summary_csv=$(
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s' \
      "$(csv_quote "$genesis_count")" \
      "$(csv_quote "$deposit_count")" \
      "$(csv_quote "$(trim_decimal "$deposit_sum")")" \
      "$(csv_quote "$exit_count")" \
      "$(csv_quote "$(trim_decimal "$exit_sum")")" \
      "$(csv_quote "$(trim_decimal "$remaining_raw")")" \
      "$(csv_quote "$(blank_dash "$current_status")")" \
      "$(csv_quote "$(blank_dash "$date_registered")")" \
      "$(csv_quote "$(blank_dash "$date_active")")" \
      "$(csv_quote "$(blank_dash "$date_exit")")"
  )

  write_csv_rows() {
    local rows="$1"
    [[ -z "$rows" ]] && return 0
    printf '%s\n' "$rows" | while IFS=$'\t' read -r date type amount from txhash; do
      printf '%s,%s,%s,%s,%s,%s,%s\n' \
        "$(csv_quote "$PUBKEY")" \
        "$(csv_quote "$date")" \
        "$(csv_quote "$type")" \
        "$(csv_quote "$amount")" \
        "$(csv_quote "$(blank_dash "$from")")" \
        "$(csv_quote "$txhash")" \
        "$summary_csv"
    done
  }

  {
    printf '%s\n' "pubkey,date,type,amount,from,txhash,total_genesis_txns,total_deposit_txns_excluding_genesis,total_deposit,total_exit_txns,total_exit,total_remaining_stake,current_status,date_registered,date_active,date_exit"
    write_csv_rows "$matches"
    write_csv_rows "$exits"
  } > "$OUTPUT"

  csv_row_count=$((genesis_count + deposit_count + exit_count))
  echo "Wrote ${csv_row_count} rows to $OUTPUT" >&2
fi
