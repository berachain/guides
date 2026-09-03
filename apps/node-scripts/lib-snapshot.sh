# Shared helpers for fetch-berachain-snapshot.sh and fetch-berachain-snapshot-v2.sh.
# shellcheck shell=bash

EL_EXPECTED="db rocksdb blobstore static_files reth.toml logs ocvm_logs invalid_block_hooks exex"
CL_EXPECTED="blockstore.db application.db state.db deposits.db evidence.db cs.wal tx_index.db snapshots"

die() {
  echo "Error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required on PATH"
}

list_top() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    return 0
  fi
  local name
  for name in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
    [[ -e "$name" ]] || continue
    basename "$name"
  done
}

in_list() {
  local needle="$1"
  local hay="$2"
  [[ " $hay " == *" $needle "* ]]
}

# prepare_target_dir DIR LABEL FORCE KEEP_LIST EXPECTED_LIST
prepare_target_dir() {
  local dir="$1" label="$2" force="$3" keep="$4" expected="$5"
  mkdir -p "$dir"
  local unexpected="" name
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if in_list "$name" "$keep"; then
      continue
    fi
    if ! in_list "$name" "$expected"; then
      unexpected+="${unexpected:+, }$name"
    fi
  done < <(list_top "$dir")
  if [[ -n "$unexpected" && "$force" != 1 ]]; then
    die "$label has unexpected contents ($unexpected). Pass --force to replace."
  fi
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if in_list "$name" "$keep"; then
      continue
    fi
    if [[ "$force" == 1 ]] || in_list "$name" "$expected"; then
      rm -rf "$dir/$name"
    fi
  done < <(list_top "$dir")
}

fingerprint() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo ""
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

snapshot_protected() {
  local home="$1"
  printf '%s %s\n' "$home/config/priv_validator_key.json" "$(fingerprint "$home/config/priv_validator_key.json")"
  printf '%s %s\n' "$home/config/jwt.hex" "$(fingerprint "$home/config/jwt.hex")"
}

assert_protected_unchanged() {
  local file hash after
  while read -r file hash; do
    [[ -n "$file" ]] || continue
    [[ -n "$hash" ]] || continue
    after=$(fingerprint "$file")
    if [[ "$after" != "$hash" ]]; then
      die "refused to overwrite protected file: $file"
    fi
    if [[ -z "$after" ]]; then
      die "protected file missing after extract: $file"
    fi
  done
}

ensure_priv_validator_state() {
  local home="$1"
  local state="$home/data/priv_validator_state.json"
  if [[ -f "$state" ]]; then
    return 0
  fi
  mkdir -p "$home/data"
  printf '%s\n' '{"height":"0","round":0,"step":0}' >"$state"
  echo "Wrote genesis $state"
}

tar_first_components() {
  local archive="$1"
  lz4 -dc "$archive" | tar -t | awk -F/ '{
    sub(/^\.\//, "", $0)
    if ($1 != "") print $1
  }' | sort -u
}

cl_extract_dir() {
  local archive="$1" home="$2"
  if tar_first_components "$archive" | grep -qx data; then
    printf '%s\n' "$home"
  else
    printf '%s\n' "$home/data"
  fi
}

el_extract_dir() {
  local archive="$1" reth="$2"
  if tar_first_components "$archive" | grep -qx data; then
    dirname "$reth"
  else
    printf '%s\n' "$reth"
  fi
}

extract_cmd() {
  local archive="$1" dest="$2"
  printf "lz4 -dc %q | tar -x -C %q --exclude=config --exclude=./config --exclude=config/priv_validator_key.json --exclude=config/jwt.hex\n" "$archive" "$dest"
}

run_extract() {
  local archive="$1" dest="$2"
  mkdir -p "$dest"
  lz4 -dc "$archive" | tar -x -C "$dest" \
    --exclude=config --exclude=./config \
    --exclude=config/priv_validator_key.json --exclude=config/jwt.hex
}

fetch_text() {
  local url="$1"
  if [[ "$url" == file://* ]]; then
    local path="${url#file://}"
    cat "$path"
    return
  fi
  curl -fsSL "$url"
}

# Pull CHAIN from env.sh without sourcing the rest (MY_IP curl, binary checks).
read_chain_from_env_file() {
  local file="$1"
  local line val
  [[ -f "$file" ]] || return 0
  line="$(grep -E '^export CHAIN=' "$file" | head -n1 || true)"
  [[ -n "$line" ]] || return 0
  val="${line#export CHAIN=}"
  val="${val%%#*}"
  val="${val//[[:space:]]/}"
  [[ -n "$val" ]] && CHAIN="$val"
}

apply_network_from_env() {
  local script_dir="$1"
  local from_flag="$2"
  [[ "$from_flag" -eq 0 ]] || return 0
  if [[ -z "${CHAIN:-}" ]]; then
    if [[ -f "$script_dir/env.sh" ]]; then
      read_chain_from_env_file "$script_dir/env.sh"
    elif [[ -f ./env.sh ]]; then
      read_chain_from_env_file ./env.sh
    fi
  fi
  NETWORK="${CHAIN:-mainnet}"
  assert_network "$NETWORK"
}

assert_network() {
  local n="$1"
  [[ "$n" == mainnet || "$n" == bepolia ]] || die "CHAIN must be mainnet or bepolia (got: ${n:-empty})"
}

source_env_if_needed() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local env_file="$here/env.sh"
  if [[ ! -f "$env_file" ]]; then
    env_file="./env.sh"
  fi
  if [[ ! -f "$env_file" ]]; then
    die "set BEACOND_DATA and RETH_DATA, or run from a node-scripts directory with env.sh"
  fi
  set +e
  set +u
  # shellcheck disable=SC1091
  . "$env_file"
  local rc=$?
  set -e
  set -u
  [[ $rc -eq 0 ]] || die "env.sh failed"
}
