#!/usr/bin/env bash
# Berachain node installer (system-wide)
# - Installs beacond + (bera-reth|bera-geth) under /opt/berachain
# - Initializes for mainnet or bepolia
# - Creates systemd services and enables them (not started by default)
#
# Requirements: bash, curl, tar, systemd, (optional) jq, openssl
# On Debian/Ubuntu, this script installs missing dependencies automatically.
#
# Usage:
#   sudo ./mkberanode.sh \
#     --chain {mainnet|bepolia} \
#     --el {reth|geth} \
#     --mode {archive|pruned} \
#     [--cl-version vX.Y.Z] \
#     [--el-version vA.B.C] \
#     [--snapshot] \
#     [--snapshot-geography {na|eu|as}]
#
# Examples:
#   sudo ./mkberanode.sh --chain mainnet --el reth --mode archive
#   sudo ./mkberanode.sh --chain bepolia --el geth --mode pruned --cl-version v1.3.2 --el-version v1.19.5
#   sudo ./mkberanode.sh --chain mainnet --el reth --mode pruned --snapshot --snapshot-geography eu

set -eu
# Enable pipefail if the shell supports it (bash, zsh). Safe no-op on dash/sh.
if (set -o pipefail) 2>/dev/null; then :; fi

# ------------------------------
# Parameters and constants
# ------------------------------
CHAIN=""            # mainnet|bepolia
EL_CHOICE=""        # reth|geth
MODE="pruned"         # archive|pruned
CL_VERSION=""       # e.g. v1.3.2 (empty: latest)
EL_VERSION=""       # e.g. v1.20.0 (empty: latest)
GENESIS_FROM_MAIN=0  # if 1, fetch EL genesis from main branch
USE_SNAPSHOT=0      # if 1, download and install snapshots
SNAPSHOT_GEOGRAPHY="na"  # na|eu|as for snapshot region

# Paths
BASE_DIR="/opt/berachain"
BIN_DIR="$BASE_DIR/bin"
DATA_DIR="$BASE_DIR/data"
CL_HOME="$DATA_DIR/cl"
EL_HOME="$DATA_DIR/el"
EL_CHAIN_DIR="$EL_HOME/chain"
CONFIG_DIR="$BASE_DIR/config"
RUNTIME_DIR="$BASE_DIR/runtime"
JWT_PATH="$RUNTIME_DIR/jwt.hex"

# Systemd
EL_SERVICE="berachain-el.service"
CL_SERVICE="berachain-cl.service"
SYSTEMD_DIR="/etc/systemd/system"

# Ports (defaults; change as desired)
EL_AUTHRPC_PORT=8551
EL_HTTP_PORT=8545
EL_WS_PORT=8546
EL_P2P_PORT=30303
CL_NODE_API_PORT=26658
CL_DEFAULT_P2P_PORT=26656

# GitHub API
GH_API="https://api.github.com"
REPO_BEACOND="berachain/beacon-kit"
REPO_RETH="berachain/bera-reth"
REPO_GETH="berachain/bera-geth"

# Network chain IDs
CHAIN_ID_MAINNET="80094"
CHAIN_ID_BEPOLIA="80069"

# Utilities
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
err()  { echo "[ERROR] $*" >&2; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || { err "Required command '$1' not found"; exit 1; }; }

print_usage() {
  cat <<EOF
Usage:
  sudo $0 --chain {mainnet|bepolia} --el {reth|geth} --mode {archive|pruned} [--cl-version vX.Y.Z] [--el-version vA.B.C] [--genesis-main] [--snapshot] [--snapshot-geography {na|eu|as}]

Examples:
  sudo $0 --chain mainnet --el reth --mode archive
  sudo $0 --chain bepolia --el geth --mode pruned --cl-version v1.3.2 --el-version v1.19.5
  sudo $0 --chain mainnet --el reth --mode pruned --snapshot --snapshot-geography eu

Notes:
- If versions are omitted, the script installs the latest releases.
- --genesis-main forces fetching BOTH EL genesis and KZG from the main branch
  (raw GitHub), regardless of the CL version used for binaries.
- --snapshot downloads and installs snapshots to skip initial sync
- --snapshot-geography selects snapshot region (na, eu, or as). Defaults to na.
EOF
}

# ------------------------------
# Argument parsing
# ------------------------------
if [[ $# -eq 0 ]]; then
  print_usage
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chain) CHAIN="${2:-}"; shift 2;;
    --el) EL_CHOICE="${2:-}"; shift 2;;
    --mode) MODE="${2:-}"; shift 2;;
    --cl-version) CL_VERSION="${2:-}"; shift 2;;
    --el-version) EL_VERSION="${2:-}"; shift 2;;
    --genesis-main) GENESIS_FROM_MAIN=1; shift 1;;
    --snapshot) USE_SNAPSHOT=1; shift 1;;
    --snapshot-geography) SNAPSHOT_GEOGRAPHY="${2:-}"; shift 2;;
    -h|--help) print_usage; exit 0;;
    *) err "Unknown arg: $1"; print_usage; exit 1;;
  esac
done

# Validate inputs
if [[ $EUID -ne 0 ]]; then
  err "Run as root (sudo)."
  exit 1
fi
case "${CHAIN:-}" in
  mainnet|bepolia) ;;
  *) err "--chain must be mainnet or bepolia"; exit 1;;
esac
case "${EL_CHOICE:-}" in
  reth|geth) ;;
  *) err "--el must be reth or geth"; exit 1;;
esac
case "${MODE:-}" in
  archive|pruned) ;;
  *) err "--mode must be archive or pruned"; exit 1;;
esac
case "${SNAPSHOT_GEOGRAPHY:-}" in
  na|eu|as) ;;
  *) err "--snapshot-geography must be na, eu, or as"; exit 1;;
esac

# ------------------------------
# OS detection & dependency install (Debian/Ubuntu)
# ------------------------------
is_debian_like() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    case "${ID:-}:${ID_LIKE:-}" in
      debian:*|ubuntu:*|*:*debian*|*:*ubuntu*) return 0;;
      *) return 1;;
    esac
  fi
  return 1
}

apt_install_if_missing() {
  local pkg="$1" bin="$2"
  if ! command -v "$bin" >/dev/null 2>&1; then
    info "Installing dependency: $pkg"
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg" >/dev/null
  fi
}

maybe_install_deps_debian() {
  if is_debian_like && command -v apt-get >/dev/null 2>&1; then
    info "Detected Debian-like system. Ensuring dependencies..."
    apt-get update -y >/dev/null
    # curl & tar are essential
    apt_install_if_missing curl curl
    apt_install_if_missing tar tar
    # lz4 for snapshot decompression
    apt_install_if_missing lz4 lz4 || warn "Failed to install lz4 - snapshots may not work"
    # jq improves API parsing but is optional
    apt_install_if_missing jq jq || warn "Failed to install jq - will use fallback parsing"
    # openssl for JWT generation
    apt_install_if_missing openssl openssl || warn "Failed to install openssl - JWT generation may fail"
    # ca-certificates ensures TLS works for curl to GitHub
    apt_install_if_missing ca-certificates update-ca-certificates || warn "Failed to update ca-certificates - TLS may fail"
  fi
}

maybe_install_deps_debian

# ------------------------------
# Pre-flight checks
# ------------------------------
need_cmd bash
need_cmd curl
need_cmd tar
need_cmd systemctl
need_cmd sed
need_cmd awk

# External IPv4 detection helper
detect_external_ip() {
  local ip
  ip=$(curl -sf ipv4.canhazip.com || true)
  if [[ -z "$ip" ]]; then
    ip=$(curl -sf https://api.ipify.org || true)
  fi
  if [[ -z "$ip" ]]; then
    ip=$(curl -sf https://ifconfig.me || true)
  fi
  echo "$ip"
}

if ! command -v jq >/dev/null 2>&1; then
  warn "jq not found; falling back to minimal parsing without jq."
  USE_JQ=0
else
  USE_JQ=1
fi
if ! command -v openssl >/dev/null 2>&1; then
  warn "openssl not found; will generate JWT using /dev/urandom."
fi

# ------------------------------
# Architecture mapping
# ------------------------------
UNAME_M="$(uname -m)"
case "$UNAME_M" in
  x86_64|amd64)
    BEACOND_ASSET_ARCH="linux-amd64"
    RETH_TARGET="x86_64-unknown-linux-gnu"
    GETH_ASSET_ARCH="linux-amd64"
    ;;
  aarch64|arm64)
    BEACOND_ASSET_ARCH="linux-arm64"
    RETH_TARGET="aarch64-unknown-linux-gnu"
    GETH_ASSET_ARCH="linux-arm64"
    ;;
  *)
    err "Unsupported architecture: $UNAME_M"
    exit 1
    ;;
esac

# ------------------------------
# Helpers: GitHub API
# ------------------------------
curl_gh() {
  local url="$1"
  curl -fsSL -H "Accept: application/vnd.github+json" "$url"
}

# Returns tag (e.g. v1.3.2) for latest release
gh_latest_tag() {
  local repo="$1"
  if [[ $USE_JQ -eq 1 ]]; then
    curl_gh "$GH_API/repos/$repo/releases/latest" | jq -r '.tag_name'
  else
    curl_gh "$GH_API/repos/$repo/releases/latest" | awk -F'"' '/"tag_name":/ {print $4; exit}'
  fi
}

# Finds asset download URL by partial name match for a given release tag
gh_asset_url_by_tag_and_match() {
  local repo="$1" tag="$2" match="$3"
  if [[ $USE_JQ -eq 1 ]]; then
    curl_gh "$GH_API/repos/$repo/releases/tags/$tag" | jq -r --arg m "$match" '.assets[] | select(.name | test($m)) | .browser_download_url' | head -n1
  else
    curl_gh "$GH_API/repos/$repo/releases/tags/$tag" | awk -v m="$match" '
      BEGIN{url=""}
      /"name":/ { if ($0 ~ m) f=1; else f=0 }
      /"browser_download_url":/ && f==1 { gsub(/[",]/,""); split($0,a,": "); print a[2]; exit }
    '
  fi
}

# ------------------------------
# Snapshot download and installation
# ------------------------------
fetch_snapshot_list() {
  local snapshot_chain="$1"
  local geography="$2"
  local bucket_url="https://storage.googleapis.com/storage/v1/b/${snapshot_chain}-${geography}/o"
  
  info "Fetching bucket contents from: $bucket_url" >&2
  curl -fsSL -H "Accept: application/json" "$bucket_url"
}

parse_single_snapshot_jq() {
  local json_data="$1" dir="$2"
  echo "$json_data" | jq -r --arg dir "$dir" '
    .items[] | 
    select(.name | startswith($dir)) | 
    select(.name | endswith(".tar.lz4")) | 
    select(.name | contains(".sha256") | not) |
    [.timeCreated, .mediaLink, .name] | 
    @tsv' | sort -r | head -n1
}

parse_single_snapshot_awk() {
  local json_data="$1" dir="$2"
  echo "$json_data" | awk -v dir="$dir" '
    /"name":/ { 
      gsub(/[",]/, ""); 
      split($0, parts, ": "); 
      name = parts[2];
      if (name ~ "^" dir && name ~ "\\.tar\\.lz4$" && name !~ "\\.sha256") {
        getline; gsub(/[",]/, ""); split($0, s, ": "); size = s[2];
        getline; gsub(/[",]/, ""); split($0, t, ": "); time = t[2];
        getline; gsub(/[",]/, ""); split($0, m, ": "); url = m[2];
        print time "\t" url "\t" name;
      }
    }' | sort -r | head -n1
}

extract_snapshot_info() {
  local json_data="$1" el_client="$2" snapshot_type="$3" snapshot_kind="$4"
  local dir
  if [[ "$snapshot_kind" == "beacon" ]]; then
    dir="beacon_${el_client}/${snapshot_type}"
  else
    dir="bera-${el_client}/${snapshot_type}"
  fi
  local result
  
  if [[ $USE_JQ -eq 1 ]]; then
    result=$(parse_single_snapshot_jq "$json_data" "$dir")
  else
    result=$(parse_single_snapshot_awk "$json_data" "$dir")
  fi
  
  if [[ -n "$result" ]]; then
    local url name
    url=$(echo "$result" | cut -f2)
    name=$(echo "$result" | cut -f3 | xargs basename 2>/dev/null || echo "$result" | cut -f3 | sed 's|.*/||')
    echo "${snapshot_kind^^}_URL='$url'"
    echo "${snapshot_kind^^}_NAME='$name'"
  else
    echo "${snapshot_kind^^}_URL=''"
    echo "${snapshot_kind^^}_NAME=''"
  fi
}

parse_snapshot_urls() {
  local json_data="$1" el_client="$2" snapshot_type="$3"
  
  # Extract beacon snapshot info
  extract_snapshot_info "$json_data" "$el_client" "$snapshot_type" "beacon"
  
  # Extract EL snapshot info  
  extract_snapshot_info "$json_data" "$el_client" "$snapshot_type" "el"
}

download_snapshot_file() {
  local url="$1"
  local filename="$2"
  local download_dir="$3"
  
  if [[ -z "$url" || -z "$filename" ]]; then
    return 1
  fi
  
  mkdir -p "$download_dir"
  local filepath="$download_dir/$filename"
  
  info "Downloading $filename..."
  if curl -L -C - -o "$filepath" "$url"; then
    info "✓ $filename - Complete"
    return 0
  else
    err "Failed to download $filename"
    return 1
  fi
}

download_snapshots() {
  if [[ $USE_SNAPSHOT -eq 0 ]]; then
    return 0
  fi

  info "Downloading snapshots..."
  
  # Determine snapshot chain name
  local snapshot_chain="bera-snapshot"
  if [[ "$CHAIN" == "bepolia" ]]; then
    snapshot_chain="bera-snapshot-testnet"
  fi
  
  # Get script directory for downloads
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local download_dir="$script_dir/downloads"
  
  # Fetch bucket contents
  local json_data
  json_data=$(fetch_snapshot_list "$snapshot_chain" "$SNAPSHOT_GEOGRAPHY")
  if [[ $? -ne 0 || -z "$json_data" ]]; then
    warn "Failed to fetch snapshot list, will proceed with normal initialization"
    return 0
  fi
  
  # Parse URLs and filenames
  local snapshot_info
  snapshot_info=$(parse_snapshot_urls "$json_data" "$EL_CHOICE" "$MODE")
  
  # Debug: show what parse_snapshot_urls returned
  info "Debug: snapshot_info output:"
  echo "$snapshot_info" >&2
  
  # Initialize variables to avoid unbound variable errors 
  BEACON_URL="" BEACON_NAME="" EL_URL="" EL_NAME=""
  
  eval "$snapshot_info"
  
  # Debug: show variable values after eval
  info "Debug: After eval - BEACON_URL='$BEACON_URL' EL_URL='$EL_URL'" >&2
  
  # Log what we'll download
  if [[ -n "$BEACON_URL" && -n "$EL_URL" ]]; then
    info "Will download the following snapshots:"
    info "  Beacon: $BEACON_NAME"
    info "    URL: $BEACON_URL"
    info "  Execution: $EL_NAME" 
    info "    URL: $EL_URL"
    echo ""
  else
    warn "No suitable snapshots found for $EL_CHOICE $MODE, will proceed with normal initialization"
    return 0
  fi
  
  # Download files
  download_snapshot_file "$BEACON_URL" "$BEACON_NAME" "$download_dir" || return 1
  download_snapshot_file "$EL_URL" "$EL_NAME" "$download_dir" || return 1
  
  info "Snapshot downloads completed"
  return 0
}

extract_snapshot_with_fallback() {
  local archive="$1" dest="$2" description="$3"
  mkdir -p "$dest"
  if lz4 -d "$archive" -c | tar -xf - -C "$dest" --strip-components=1 2>/dev/null; then
    return 0
  else
    info "Trying extraction without strip-components for $description..."
    if lz4 -d "$archive" -c | tar -xf - -C "$dest" 2>/dev/null; then
      return 0
    else
      warn "Failed to extract $description, will proceed with fresh sync"
      return 1
    fi
  fi
}

install_snapshots() {
  if [[ $USE_SNAPSHOT -eq 0 ]]; then
    return 0
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local snapshot_dir="$script_dir/downloads"
  
  if [[ ! -d "$snapshot_dir" ]]; then
    warn "Snapshot directory not found, skipping snapshot installation"
    return 0
  fi

  info "Installing snapshots..."
  
  # Find the downloaded snapshot files
  local beacon_snapshot el_snapshot
  beacon_snapshot=$(find "$snapshot_dir" -name "snapshot_beacond_${EL_CHOICE}_${MODE}_*.tar.lz4" | head -n1)
  el_snapshot=$(find "$snapshot_dir" -name "bera-${EL_CHOICE}-*${MODE}*.tar.lz4" | head -n1)
  
  # Install beacon snapshot
  if [[ -n "$beacon_snapshot" && -f "$beacon_snapshot" ]]; then
    info "Installing beacon snapshot: $(basename "$beacon_snapshot")"
    if extract_snapshot_with_fallback "$beacon_snapshot" "$CL_HOME" "beacon snapshot"; then
      chown -R berachain:berachain "$CL_HOME" 2>/dev/null || warn "Failed to set ownership for CL snapshot data"
    fi
  else
    info "No beacon snapshot found, will sync from genesis"
  fi
  
  # Install execution layer snapshot
  if [[ -n "$el_snapshot" && -f "$el_snapshot" ]]; then
    info "Installing execution layer snapshot: $(basename "$el_snapshot")"
    if extract_snapshot_with_fallback "$el_snapshot" "$EL_HOME" "execution layer snapshot"; then
      chown -R berachain:berachain "$EL_HOME" 2>/dev/null || warn "Failed to set ownership for EL snapshot data"
    fi
  else
    info "No execution layer snapshot found, will sync from genesis"
  fi
  
  info "Snapshot installation completed"
}

# ------------------------------
# User/group and directories
# ------------------------------
ensure_user_and_dirs() {
  info "Creating berachain system user and directories..."
  getent group berachain >/dev/null 2>&1 || groupadd --system berachain
  if ! id -u berachain >/dev/null 2>&1; then
    useradd --system --home-dir "$BASE_DIR" --shell /usr/sbin/nologin --gid berachain berachain
  fi

  mkdir -p "$BIN_DIR" "$CL_HOME" "$EL_CHAIN_DIR" "$CONFIG_DIR" "$RUNTIME_DIR"
  chown -R berachain:berachain "$BASE_DIR"
  chmod 0755 "$BASE_DIR"
}

# ------------------------------
# Downloads and installs binaries
# ------------------------------
install_beacond() {
  local tag="${CL_VERSION:-}"
  if [[ -z "$tag" ]]; then
    info "Resolving latest beacond release tag..."
    tag="$(gh_latest_tag "$REPO_BEACOND")"
  fi
  info "Installing beacond $tag ($BEACOND_ASSET_ARCH)"
  local match="beacond-${tag}-${BEACOND_ASSET_ARCH}\\.tar\\.gz"
  local url
  url="$(gh_asset_url_by_tag_and_match "$REPO_BEACOND" "$tag" "$match")"
  [[ -n "$url" ]] || { err "Could not find beacond asset for $tag / $BEACOND_ASSET_ARCH"; exit 1; }

  local tmpdir; tmpdir="$(mktemp -d)"
  local extract_dir="$tmpdir/extract"
  mkdir -p "$extract_dir"
  curl -sfSL "$url" -o "$tmpdir/beacond.tgz"
  tar -xzf "$tmpdir/beacond.tgz" -C "$extract_dir"
  # Select exactly one file from the archive (prefer names starting with 'beacond')
  local path
  mapfile -t _cand < <(find "$extract_dir" -type f -name 'beacond*' 2>/dev/null)
  if [[ ${#_cand[@]} -eq 1 ]]; then
    path="${_cand[0]}"
  else
    mapfile -t _cand < <(find "$extract_dir" -type f ! -name '*.asc' 2>/dev/null)
    if [[ ${#_cand[@]} -eq 1 ]]; then
      path="${_cand[0]}"
    else
      err "Expected a single beacond file in archive, found ${#_cand[@]}. Contents:"
      find "$extract_dir" -maxdepth 2 -mindepth 1 -printf '  - %P\n' || true
      rm -rf "$tmpdir"
      exit 1
    fi
  fi
  chmod +x "$path" || true
  install -m 0755 "$path" "$BIN_DIR/beacond"
  chown berachain:berachain "$BIN_DIR/beacond"
  rm -rf "$tmpdir"
}

install_el() {
  local tag="${EL_VERSION:-}" repo="" url="" tmpdir match path
  if [[ "$EL_CHOICE" == "reth" ]]; then
    repo="$REPO_RETH"
    if [[ -z "$tag" ]]; then
      info "Resolving latest bera-reth release tag..."
      tag="$(gh_latest_tag "$repo")"
    fi
    info "Installing bera-reth $tag ($RETH_TARGET)"
    match="bera-reth-${tag}-${RETH_TARGET}\\.tar\\.gz"
    url="$(gh_asset_url_by_tag_and_match "$repo" "$tag" "$match")"
    [[ -n "$url" ]] || { err "Could not find bera-reth asset for $tag / $RETH_TARGET"; exit 1; }
    tmpdir="$(mktemp -d)"
    curl -sfSL "$url" -o "$tmpdir/reth.tgz"
    tar -xzf "$tmpdir/reth.tgz" -C "$tmpdir"
    path="$(find "$tmpdir" -type f -name 'bera-reth*' -perm -u+x | head -n1 || true)"
    [[ -n "$path" ]] || { err "bera-reth binary not found in archive"; exit 1; }
    install -m 0755 "$path" "$BIN_DIR/bera-reth"
    chown berachain:berachain "$BIN_DIR/bera-reth"
    rm -rf "$tmpdir"
  else
    repo="$REPO_GETH"
    if [[ -z "$tag" ]]; then
      info "Resolving latest bera-geth release tag..."
      tag="$(gh_latest_tag "$repo")"
    fi
    info "Installing bera-geth $tag ($GETH_ASSET_ARCH)"
    match="bera-geth-${GETH_ASSET_ARCH}-.*\\.tar\\.gz$"
    url="$(gh_asset_url_by_tag_and_match "$repo" "$tag" "$match")"
    [[ -n "$url" ]] || { err "Could not find bera-geth asset for $tag / $GETH_ASSET_ARCH"; exit 1; }
    tmpdir="$(mktemp -d)"
    curl -sfSL "$url" -o "$tmpdir/geth.tgz"
    tar -xzf "$tmpdir/geth.tgz" -C "$tmpdir"
    path="$(find "$tmpdir" -type f -name 'bera-geth*' -perm -u+x | head -n1 || true)"
    [[ -n "$path" ]] || { err "bera-geth binary not found in archive"; exit 1; }
    install -m 0755 "$path" "$BIN_DIR/bera-geth"
    chown berachain:berachain "$BIN_DIR/bera-geth"
    rm -rf "$tmpdir"
  fi
}

# ------------------------------
# Network files for EL init
# ------------------------------
construct_network_url() {
  local file="$1" chain_id="$2"
  if [[ "$GENESIS_FROM_MAIN" -eq 1 ]]; then
    echo "https://raw.githubusercontent.com/berachain/beacon-kit/main/testing/networks/${chain_id}/${file}"
  else
    echo "https://raw.githubusercontent.com/berachain/beacon-kit/${CL_VERSION}/testing/networks/${chain_id}/${file}"
  fi
}

fetch_network_files() {
  local chain_id file_url

  if [[ -z "${CL_VERSION:-}" ]]; then
    # Align network files with installed beacond tag if possible
    CL_VERSION="$(gh_latest_tag "$REPO_BEACOND")"
  fi

  case "$CHAIN" in
    mainnet) chain_id="$CHAIN_ID_MAINNET" ;;
    bepolia) chain_id="$CHAIN_ID_BEPOLIA" ;;
  esac

  mkdir -p "$CONFIG_DIR/el" "$CONFIG_DIR/cl"
  chown -R berachain:berachain "$CONFIG_DIR"

  # Execution genesis
  file_url="$(construct_network_url "eth-genesis.json" "$chain_id")"
  info "Downloading EL genesis: $file_url"
  curl -sfSL "$file_url" -o "$CONFIG_DIR/el/genesis.json" || { err "Failed to fetch EL genesis from $file_url"; exit 1; }

  # KZG trusted setup (for beacond)
  file_url="$(construct_network_url "kzg-trusted-setup.json" "$chain_id")"
  info "Downloading KZG trusted setup: $file_url"
  curl -sfSL "$file_url" -o "$CONFIG_DIR/kzg-trusted-setup.json" || { err "Failed to fetch KZG trusted setup from $file_url"; exit 1; }

  # Consensus Layer genesis.json for beacond config
  file_url="$(construct_network_url "genesis.json" "$chain_id")"
  info "Downloading CL genesis: $file_url"
  curl -sfSL "$file_url" -o "$CONFIG_DIR/cl/genesis.json" || { err "Failed to fetch CL genesis from $file_url"; exit 1; }

  # Also fetch CL config files (config.toml, app.toml) and EL peer lists if present
  for f in config.toml app.toml el-bootnodes.txt el-peers.txt; do
    file_url="$(construct_network_url "$f" "$chain_id")"
    if curl -sfSL "$file_url" -o "$CONFIG_DIR/cl/$f"; then
      info "Downloaded $f"
    else
      info "Optional network file not found: $file_url"
    fi
  done

  chown -R berachain:berachain "$CONFIG_DIR"
}

# ------------------------------
# Initialization (EL and CL)
# ------------------------------
init_el() {
  info "Initializing EL database..."
  
  # Check if snapshots were installed and contain data
  local has_snapshot_data=0
  if [[ "$EL_CHOICE" == "reth" ]]; then
    if [[ -f "$EL_CHAIN_DIR/db/mdbx.dat" ]]; then
      has_snapshot_data=1
      info "Found existing reth database from snapshot."
    fi
  else
    if [[ -d "$EL_CHAIN_DIR/bera-geth" ]]; then
      has_snapshot_data=1
      info "Found existing geth database from snapshot."
    fi
  fi
  
  # Only initialize from genesis if no snapshot data exists
  if [[ $has_snapshot_data -eq 0 ]]; then
    if [[ "$EL_CHOICE" == "reth" ]]; then
      # Prepare reth config directory and place EL genesis where reth expects it (mimic berabox)
      mkdir -p "$EL_HOME/config"
      cp -f "$CONFIG_DIR/el/genesis.json" "$EL_HOME/config/genesis.json"
      chown -R berachain:berachain "$EL_HOME/config"
      sudo -u berachain bash -c "cd '$EL_HOME' && '$BIN_DIR/bera-reth' init --datadir ./chain/ --chain ./config/genesis.json >/dev/null 2>&1"
    else
      "$BIN_DIR/bera-geth" init --state.scheme=path --datadir "$EL_CHAIN_DIR" "$CONFIG_DIR/el/genesis.json" >/dev/null 2>&1
      chown -R berachain:berachain "$EL_HOME"
    fi
  else
    info "Skipping EL genesis initialization - using snapshot data."
  fi
}

init_cl() {
  local chain_id
  case "$CHAIN" in
    mainnet) chain_id="$CHAIN_ID_MAINNET" ;;
    bepolia) chain_id="$CHAIN_ID_BEPOLIA" ;;
  esac

  info "Initializing beacond home at $CL_HOME..."
  if [[ ! -f "$CL_HOME/config/genesis.json" ]]; then
    sudo -u berachain "$BIN_DIR/beacond" 2>/dev/null init "berachain-node" --chain-id "$chain_id" --home "$CL_HOME" --beacon-kit.chain-spec "$CHAIN"
    # After init, place network files into beacond config (mimic berabox init)
    if [[ -f "$CONFIG_DIR/cl/genesis.json" ]]; then
      cp -f "$CONFIG_DIR/cl/genesis.json" "$CL_HOME/config/genesis.json"
    fi
    if [[ -f "$CONFIG_DIR/kzg-trusted-setup.json" ]]; then
      cp -f "$CONFIG_DIR/kzg-trusted-setup.json" "$CL_HOME/config/kzg-trusted-setup.json"
    fi
    # Overwrite beacond config files with network configs if fetched
    if [[ -f "$CONFIG_DIR/cl/config.toml" ]]; then
      cp -f "$CONFIG_DIR/cl/config.toml" "$CL_HOME/config/config.toml"
    fi
    if [[ -f "$CONFIG_DIR/cl/app.toml" ]]; then
      cp -f "$CONFIG_DIR/cl/app.toml" "$CL_HOME/config/app.toml"
    fi
    # Copy EL peer lists for reference/other tooling
    for f in el-bootnodes.txt el-peers.txt; do
      if [[ -f "$CONFIG_DIR/cl/$f" ]]; then
        cp -f "$CONFIG_DIR/cl/$f" "$CL_HOME/config/$f"
      fi
    done
    # Update app.toml paths and settings
    if [[ -f "$CL_HOME/config/app.toml" ]]; then
      sed -i "s|^rpc-dial-url = \".*\"|rpc-dial-url = \"http://localhost:$EL_AUTHRPC_PORT\"|" "$CL_HOME/config/app.toml" || true
      sed -i "s|^jwt-secret-path = \".*\"|jwt-secret-path = \"$JWT_PATH\"|" "$CL_HOME/config/app.toml" || true
      sed -i "s|^trusted-setup-path = \".*\"|trusted-setup-path = \"$CL_HOME/config/kzg-trusted-setup.json\"|" "$CL_HOME/config/app.toml" || true
      # Pruning depends on mode: archive => nothing, pruned => default
      if [[ "$MODE" == "archive" ]]; then
        if grep -q '^pruning\s*=\s*"' "$CL_HOME/config/app.toml"; then
          sed -i "s|^pruning\s*=\s*\".*\"|pruning = \"nothing\"|" "$CL_HOME/config/app.toml" || true
        else
          echo "pruning = \"nothing\"" >> "$CL_HOME/config/app.toml"
        fi
      else
        if grep -q '^pruning\s*=\s*"' "$CL_HOME/config/app.toml"; then
          sed -i "s|^pruning\s*=\s*\".*\"|pruning = \"default\"|" "$CL_HOME/config/app.toml" || true
        else
          echo "pruning = \"default\"" >> "$CL_HOME/config/app.toml"
        fi
      fi
    fi
    # Write external_address using detected IP and existing P2P port (fallback 26656)
    local detected_ip
    detected_ip=$(detect_external_ip)
    if [[ -n "$detected_ip" && -f "$CL_HOME/config/config.toml" ]]; then
      # Try to extract port from existing external_address or fallback to default
      existing_port=$(grep -E '^external_address\s*=\s*".*:[0-9]+' "$CL_HOME/config/config.toml" | sed -E 's/.*:([0-9]+)"/\1/' | head -n1 || true)
      if [[ -z "$existing_port" ]]; then existing_port="$CL_DEFAULT_P2P_PORT"; fi
      sed -i "s|^external_address = \".*\"|external_address = \"${detected_ip}:$existing_port\"|" "$CL_HOME/config/config.toml" || true
    fi
    chown -R berachain:berachain "$CL_HOME/config"
  else
    info "beacond already initialized."
  fi
}

ensure_jwt() {
  if [[ ! -f "$JWT_PATH" ]]; then
    info "Generating JWT secret with beacond..."
    mkdir -p "$RUNTIME_DIR"
    chown berachain:berachain "$RUNTIME_DIR"
    # Use beacond's built-in JWT generator with explicit output path
    sudo -u berachain "$BIN_DIR/beacond" jwt generate -o "$JWT_PATH"
    chown berachain:berachain "$JWT_PATH"
    chmod 0640 "$JWT_PATH"
    echo ""
  fi
}

# ------------------------------
# Systemd service creation
# ------------------------------
install_systemd_units() {
  info "Creating systemd units..."

  # EL unit
  local el_exec el_args bootnodes_arg=""
  # Build bootnodes list from file if present
  if [[ -f "$CL_HOME/config/el-bootnodes.txt" ]]; then
    # keep only enode:// lines, comma separated
    BOOTNODES=$(grep '^enode://' "$CL_HOME/config/el-bootnodes.txt" | tr '\n' ',' | sed 's/,$//')
    if [[ -n "$BOOTNODES" ]]; then
      bootnodes_arg="--bootnodes $BOOTNODES"
    fi
  fi
  if [[ "$EL_CHOICE" == "reth" ]]; then
    # Reth: non-archive uses --full; archive omits it
    local reth_mode_flag=""
    if [[ "$MODE" != "archive" ]]; then reth_mode_flag="--full"; fi
    el_exec="$BIN_DIR/bera-reth"
    el_args="node --datadir $EL_CHAIN_DIR \
      --http --http.addr 0.0.0.0 --http.port $EL_HTTP_PORT \
      --ws --ws.addr 0.0.0.0 --ws.port $EL_WS_PORT \
      --authrpc.addr 127.0.0.1 --authrpc.port $EL_AUTHRPC_PORT --authrpc.jwtsecret $JWT_PATH \
      --port $EL_P2P_PORT --chain $EL_HOME/config/genesis.json $bootnodes_arg $reth_mode_flag"
  else
    # Geth: archive uses history flags; also run with PBSS and full sync
    local geth_archive_flags=""
    if [[ "$MODE" == "archive" ]]; then
      geth_archive_flags="--history.logs 0 --history.state 0 --history.transactions 0"
    fi
    el_exec="$BIN_DIR/bera-geth"
    el_args="--datadir $EL_CHAIN_DIR \
      --syncmode full --state.scheme path \
      --http --http.addr 0.0.0.0 --http.port $EL_HTTP_PORT \
      --ws --ws.addr 0.0.0.0 --ws.port $EL_WS_PORT \
      --authrpc.addr 127.0.0.1 --authrpc.port $EL_AUTHRPC_PORT --authrpc.jwtsecret $JWT_PATH \
      --port $EL_P2P_PORT $bootnodes_arg $geth_archive_flags"
  fi

  # Append NAT external IP if available (advertise correct external address)
  NAT_IP=$(detect_external_ip)
  if [[ -n "$NAT_IP" ]]; then
    el_args+=" --nat extip:$NAT_IP"
  fi

  cat > "$SYSTEMD_DIR/$EL_SERVICE" <<UNIT
[Unit]
Description=Berachain Execution Layer ($EL_CHOICE)
Wants=network-online.target
After=network-online.target

[Service]
User=berachain
Group=berachain
ExecStart=$el_exec $el_args
Restart=always
RestartSec=3
TimeoutStopSec=60s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

  # CL unit
  local cl_exec="$BIN_DIR/beacond" beacon_network_type

  if [[ "$CHAIN" == "mainnet" ]]; then
    beacon_network_type="mainnet"
  elif [[ "$CHAIN" == "bepolia" ]]; then
    beacon_network_type="testnet"
  fi

  local cl_args="start --home $CL_HOME \
    --beacon-kit.chain-spec $beacon_network_type \
    --beacon-kit.engine.jwt-secret-path $JWT_PATH \
    --beacon-kit.engine.rpc-dial-url http://127.0.0.1:$EL_AUTHRPC_PORT \
    --beacon-kit.kzg.trusted-setup-path $CONFIG_DIR/kzg-trusted-setup.json \
    --beacon-kit.node-api.enabled=true \
    --beacon-kit.node-api.address=0.0.0.0:$CL_NODE_API_PORT"

  cat > "$SYSTEMD_DIR/$CL_SERVICE" <<UNIT
[Unit]
Description=Berachain Consensus Layer (beacond)
Requires=$EL_SERVICE
After=$EL_SERVICE

[Service]
User=berachain
Group=berachain
ExecStart=$cl_exec $cl_args
WorkingDirectory=$BASE_DIR
Restart=always
RestartSec=3
TimeoutStopSec=60s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

  info "Reloading systemd and enabling services..."
  systemctl daemon-reload
  systemctl enable "$EL_SERVICE" "$CL_SERVICE"
}

# ------------------------------
# Main
# ------------------------------
main() {
  bold "Berachain installer starting…"
  ensure_user_and_dirs
  install_beacond
  install_el
  fetch_network_files
  download_snapshots
  install_snapshots
  init_el
  init_cl
  ensure_jwt
  install_systemd_units

  cat <<EON

All set.

Next steps (you run these):
  sudo systemctl start $EL_SERVICE
  sleep 2
  sudo systemctl start $CL_SERVICE

Check logs:
  sudo journalctl -u $EL_SERVICE -f -n 200
  sudo journalctl -u $CL_SERVICE -f -n 200

Set up monitoring by following the guide at https://docs.berachain.com/nodes/monitoring .
EON
}

main



