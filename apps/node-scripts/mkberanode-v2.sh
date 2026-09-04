#!/usr/bin/env bash
# Berachain node installer (system-wide) -- storage v2 snapshots
# - Installs beacond + bera-reth under /opt/berachain
# - Initializes for mainnet or bepolia
# - Creates systemd services and enables them (not started by default)
#
# Storage v2 only: this variant assumes mainnet's storage v2 catalog is
# shaped exactly like Bepolia's (same v2/<chain>/catalog.csv schema, same
# el-manifest/cl-pruned/cl-archive roles) -- there is no v1 fallback and no
# "mainnet not ready" special case. If your mainnet host has no v2 catalog
# yet, use mkberanode.sh instead.
#
# Requirements: bash, curl, tar, systemd, (optional) jq, openssl
# On Debian/Ubuntu, this script installs missing dependencies automatically.
#
# Usage:
#   sudo ./mkberanode-v2.sh \
#     --chain {mainnet|bepolia} \
#     --mode {archive|pruned} \
#     [--cl-version vX.Y.Z] \
#     [--el-version vA.B.C] \
#     [--no-snapshot] \
#     [--stream-snapshots] \
#     [--snapshot-download-dir DIR] \
#     [--keep-snapshot-downloads]
#
# --mode controls both the local CL retention posture (as in mkberanode.sh)
# and which storage v2 CL product seeds it: pruned mode restores cl-pruned
# and sets beacond pruning = "default"; archive mode restores cl-archive
# (full CL history) and sets beacond pruning = "nothing". This matches the
# meaning --mode already had; it is not the fetch-berachain-snapshot-v2.js
# --type flag, which is EL-only and needs a separate --full-cl to reach
# cl-archive.

set -eu
# Enable pipefail if the shell supports it (bash, zsh). Safe no-op on dash/sh.
if (set -o pipefail) 2>/dev/null; then :; fi

# ------------------------------
# Parameters and constants
# ------------------------------
CHAIN=""            # mainnet|bepolia
MODE=""               # archive|pruned (required)
CL_VERSION=""       # e.g. v1.3.2 (empty: latest)
EL_VERSION=""       # e.g. v1.20.0 (empty: latest)
USE_SNAPSHOT=1      # if 1, download and install snapshots
SNAPSHOT_STREAM=0   # if 1, pipe curl|lz4|tar for CL; if 0 (default), download to disk then extract
SNAPSHOT_KEEP_DOWNLOADS=0  # if 1, keep CL .tar.lz4 after successful extract
SNAPSHOT_DOWNLOAD_DIR=""  # empty: default under BASE_DIR (set after BASE_DIR)

# Paths
BASE_DIR="/opt/berachain"
BIN_DIR="$BASE_DIR/bin"
CL_HOME="$BASE_DIR/var/beacond"
EL_HOME="$BASE_DIR/var/el"
CONFIG_DIR="$BASE_DIR/chainspec"
RUNTIME_DIR="$BASE_DIR/runtime"
JWT_PATH="$RUNTIME_DIR/jwt.hex"
# Populated after BASE_DIR is defined (default snapshot cache location, CL only)
SNAPSHOT_DOWNLOAD_DIR_DEFAULT="$BASE_DIR/var/snapshot-downloads"

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

# Network chain IDs
CHAIN_ID_MAINNET="80094"
CHAIN_ID_BEPOLIA="80069"

# Storage v2 public catalog. Same base for every chain -- mainnet is not
# special-cased.
V2_PUBLIC_BASE="https://bera-snapshots.fsn1.your-objectstorage.com"

# Utilities
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
err()  { echo "[ERROR] $*" >&2; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || { err "Required command '$1' not found"; exit 1; }; }

print_usage() {
  cat <<EOF
Usage:
  sudo $0 --chain {mainnet|bepolia} --mode {archive|pruned}
    [--cl-version vX.Y.Z] [--el-version vA.B.C]
    [--no-snapshot]
    [--stream-snapshots]
    [--snapshot-download-dir DIR]
    [--keep-snapshot-downloads]

Storage v2 snapshots (execution layer via bera-reth download, consensus layer
via curl|lz4|tar; default: CL archive download to $SNAPSHOT_DOWNLOAD_DIR_DEFAULT
then extract; uses aria2c when installed for resumable multi-connection CL
downloads, else curl with resume):

  --stream-snapshots          Stream the CL tarball over the network (curl | lz4 | tar),
                               no full archive on disk. EL always uses bera-reth's own
                               resumable downloader regardless of this flag.
  --snapshot-download-dir     Override CL download directory (default: $SNAPSHOT_DOWNLOAD_DIR_DEFAULT)
  --keep-snapshot-downloads   Keep the CL .tar.lz4 file after successful extract

Examples:
  sudo $0 --chain mainnet --mode archive
  sudo $0 --chain bepolia --mode pruned --cl-version v1.3.2 --el-version v1.19.5
  sudo $0 --chain mainnet --mode pruned --no-snapshot
  sudo $0 --chain mainnet --mode archive --stream-snapshots
  sudo $0 --chain mainnet --mode archive --snapshot-download-dir /mnt/nvme/snapshots

EOF
}

# ------------------------------
# Argument parsing
# ------------------------------
if [[ $# -eq 0 ]]; then
  print_usage
  exit 1
fi

# Disallow running via interactive shells that inject completion noise
if [[ -n ${BASH_COMPLETION_VERSINFO-} || $(type -t dump_bash_state || true) == function ]]; then
  # Try to disable completion shim if sourced in environment
  unset -f dump_bash_state >/dev/null 2>&1 || true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chain) CHAIN="${2:-}"; shift 2;;
    --mode) MODE="${2:-}"; shift 2;;
    --cl-version) CL_VERSION="${2:-}"; shift 2;;
    --el-version) EL_VERSION="${2:-}"; shift 2;;
    --no-snapshot) USE_SNAPSHOT=0; shift 1;;
    --stream-snapshots) SNAPSHOT_STREAM=1; shift 1;;
    --snapshot-download-dir) SNAPSHOT_DOWNLOAD_DIR="${2:-}"; shift 2;;
    --keep-snapshot-downloads) SNAPSHOT_KEEP_DOWNLOADS=1; shift 1;;
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
case "${MODE:-}" in
  archive|pruned) ;;
  *) err "--mode must be archive or pruned"; exit 1;;
esac

if [[ -z "${SNAPSHOT_DOWNLOAD_DIR}" ]]; then
  SNAPSHOT_DOWNLOAD_DIR="$SNAPSHOT_DOWNLOAD_DIR_DEFAULT"
fi
if [[ "${SNAPSHOT_DOWNLOAD_DIR}" != /* ]]; then
  err "--snapshot-download-dir must be an absolute path"
  exit 1
fi

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
  info "Detected Debian-like system. Ensuring dependencies..."
  if ! DEBIAN_FRONTEND=noninteractive apt-get update -y; then
    err "apt-get update failed. Check network/apt mirrors and retry."
    exit 1
  fi
  # curl & tar are essential
  apt_install_if_missing curl curl
  apt_install_if_missing tar tar
  # lz4 for CL snapshot decompression
  apt_install_if_missing lz4 lz4 || warn "Failed to install lz4 - CL snapshot may not work"
  # openssl for JWT generation
  apt_install_if_missing openssl openssl || warn "Failed to install openssl - JWT generation may fail"
  # ca-certificates ensures TLS works for curl to GitHub / the snapshot bucket
  apt_install_if_missing ca-certificates update-ca-certificates || warn "Failed to update ca-certificates - TLS may fail"
  # Resumable multi-connection CL snapshot downloads (optional; curl resume is fallback)
  if [[ $USE_SNAPSHOT -eq 1 && $SNAPSHOT_STREAM -eq 0 ]]; then
    apt_install_if_missing aria2 aria2c || info "aria2 not installed; CL snapshot download will use curl with resume"
  fi
}

# Enforce Debian/Ubuntu systems only
if ! is_debian_like; then
  err "This installer supports Debian/Ubuntu only."
  exit 1
fi

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
need_cmd lsblk
need_cmd findmnt
need_cmd md5sum

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
    ;;
  aarch64|arm64)
    BEACOND_ASSET_ARCH="linux-arm64"
    RETH_TARGET="aarch64-unknown-linux-gnu"
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
  curl_gh "$GH_API/repos/$repo/releases/latest" | jq -r '.tag_name'
}

# Finds asset download URL by partial name match for a given release tag
gh_asset_url_by_tag_and_match() {
  local repo="$1" tag="$2" match="$3"
  curl_gh "$GH_API/repos/$repo/releases/tags/$tag" | jq -r --arg m "$match" '.assets[] | select(.name | test($m)) | .browser_download_url' | head -n1
}

need_cmd jq

# ------------------------------
# Snapshot download and installation (storage v2)
# ------------------------------

# Fetches the storage v2 catalog for one chain. Mainnet and Bepolia use the
# identical path shape (v2/<chain>/catalog.csv) -- no per-chain branching.
fetch_v2_catalog() {
  local chain="$1"
  local catalog_url="$V2_PUBLIC_BASE/v2/${chain}/catalog.csv"
  info "Fetching storage v2 catalog: $catalog_url" >&2
  curl -fsSL "$catalog_url"
}

V2_CATALOG_HEADER="type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role"

# Selects the download_url (column 8) for the single row matching role
# (column 9) from v2 catalog.csv text. Object keys and URLs use '/' rather
# than ',', so a plain field split is safe. Reads the URL from the catalog,
# does not construct it -- the object key layout is an implementation
# detail of the publish pipeline, not a contract this script should assume.
select_v2_role() {
  local csv_data="$1" role="$2"
  local header
  header="$(printf '%s\n' "$csv_data" | head -n1 | tr -d '\r')"
  if [[ "$header" != "$V2_CATALOG_HEADER" ]]; then
    err "storage v2 catalog header mismatch (expected: $V2_CATALOG_HEADER)"
    return 1
  fi
  local url
  url=$(echo "$csv_data" | awk -F',' -v role="$role" 'NR>1 && $9==role { print $8; found=1 } END { exit !found }')
  [[ -n "$url" ]] || return 1
  echo "$url"
}

# Set when EL restore actually completed via bera-reth download, so init_el
# knows to skip `bera-reth init` -- the download already initialized and
# configured the EL datadir; running init again on top of it is redundant
# at best and, given every other restore command in this campaign refuses
# a non-empty --datadir, plausibly fatal at worst.
EL_SNAPSHOT_INSTALLED=0

install_snapshots_v2() {
  if [[ $USE_SNAPSHOT -eq 0 ]]; then
    return 0
  fi

  info "Resolving storage v2 snapshot URLs for chain ${CHAIN}..."
  local csv_data
  csv_data=$(fetch_v2_catalog "$CHAIN") || csv_data=""
  if [[ -z "$csv_data" ]]; then
    warn "Failed to fetch storage v2 catalog, will proceed with normal initialization"
    return 0
  fi

  local el_manifest_url=""
  el_manifest_url=$(select_v2_role "$csv_data" "el-manifest") || {
    warn "storage v2 catalog missing el-manifest row; will sync EL from genesis"
    el_manifest_url=""
  }

  # --mode already controls the local CL retention posture (see init_cl's
  # pruning = "nothing"/"default" choice below); mirror that same choice
  # when picking which v2 CL product seeds this install.
  local cl_role="cl-pruned"
  [[ "$MODE" == "archive" ]] && cl_role="cl-archive"
  local cl_url=""
  cl_url=$(select_v2_role "$csv_data" "$cl_role") || {
    warn "storage v2 catalog missing $cl_role row; will sync CL from genesis"
    cl_url=""
  }

  # Execution snapshot: bera-reth's own download command handles fetch,
  # extraction, per-file checksum verification, and resumable retry -- no
  # separate curl|tar step, unlike v1 or the CL leg below. Preset must match
  # the EL systemd unit's own runtime flag (install_systemd_units): --mode
  # pruned runs the node with --full, not --minimal, so restoring --minimal
  # here would under-provision it relative to its own pruning policy.
  if [[ -n "$el_manifest_url" ]]; then
    local should_skip=0
    if [[ -d "$EL_HOME/data/db" && -n "$(ls -A "$EL_HOME/data/db" 2>/dev/null)" ]]; then
      should_skip=1
    fi
    if [[ $should_skip -eq 1 ]]; then
      info "Detected existing EL data; skipping execution snapshot"
    else
      local el_preset="--full"
      [[ "$MODE" == "archive" ]] && el_preset="--archive"
      info "Restoring execution layer via bera-reth download ($el_preset)"
      mkdir -p "$EL_HOME/data"
      chown -R berachain:berachain "$EL_HOME"
      if sudo -u berachain "$BIN_DIR/bera-reth" download \
          --chain "$CHAIN" --datadir "$EL_HOME/data" \
          --manifest-url "$el_manifest_url" "$el_preset"; then
        EL_SNAPSHOT_INSTALLED=1
        chown -R berachain:berachain "$EL_HOME" 2>/dev/null || warn "Failed to set ownership for EL snapshot data"
      else
        warn "Execution snapshot install failed; will sync from genesis"
      fi
    fi
  else
    info "No execution manifest URL; will sync from genesis"
  fi

  # Consensus snapshot: still a single tarball object per role, same
  # curl|lz4|tar path as v1.
  if [[ -n "$cl_url" ]]; then
    local should_skip=0
    if [[ -d "$CL_HOME/data/blockstore.db" && -n "$(ls -A "$CL_HOME/data/blockstore.db" 2>/dev/null)" ]]; then
      info "Detected existing CL data at $CL_HOME/data/blockstore.db; skipping beacon snapshot"
      should_skip=1
    fi
    if [[ $should_skip -eq 0 ]]; then
      local ok=0
      if [[ $SNAPSHOT_STREAM -eq 1 ]]; then
        info "Streaming beacon snapshot ($cl_role)"
        stream_extract "$cl_url" "$CL_HOME/data" "beacon snapshot" && ok=1 || ok=0
      else
        local stored
        stored="$(snapshot_stored_archive_name "$cl_url")"
        disk_extract_snapshot "$cl_url" "$CL_HOME/data" "$stored" "beacon snapshot ($cl_role)" && ok=1 || ok=0
      fi
      if [[ $ok -eq 1 ]]; then
        chown -R berachain:berachain "$CL_HOME" 2>/dev/null || warn "Failed to set ownership for CL snapshot data"
      else
        warn "Beacon snapshot install failed; will sync from genesis"
      fi
    fi
  else
    info "No consensus snapshot URL; will sync from genesis"
  fi

  if [[ $SNAPSHOT_STREAM -eq 0 && "$SNAPSHOT_DOWNLOAD_DIR" == "$BASE_DIR"/* ]]; then
    chown -R berachain:berachain "$SNAPSHOT_DOWNLOAD_DIR" 2>/dev/null || true
  fi
  info "Storage v2 snapshot installation completed"
}

# CL-only download helpers (EL restore above goes through bera-reth directly
# and never calls these).
snapshot_stored_archive_name() {
  local url="$1"
  local base
  base=$(echo "$url" | sed 's|.*/||;s/?.*//')
  echo "${CHAIN}__${base}"
}

download_snapshot_archive() {
  local url="$1"
  local output_path="$2"
  local desc="${3:-snapshot}"
  local out_dir out_base
  out_dir=$(dirname "$output_path")
  out_base=$(basename "$output_path")
  mkdir -p "$out_dir"
  if command -v aria2c >/dev/null 2>&1; then
    info "Downloading $desc with aria2c (resumable) → $output_path"
    aria2c --continue=true --max-connection-per-server=16 --split=16 --min-split-size=4M \
      --file-allocation=none --dir="$out_dir" --out="$out_base" "$url"
  else
    info "Downloading $desc with curl (resume if partial) → $output_path"
    curl -fL --continue-at - --output "$output_path" "$url"
  fi
}

extract_lz4_tar_to() {
  local archive="$1"
  local dest="$2"
  mkdir -p "$dest"
  lz4 -dc "$archive" | tar -xf - -C "$dest"
}

disk_extract_snapshot() {
  local url="$1" dest="$2" stored_name="$3" label="$4"
  local path="$SNAPSHOT_DOWNLOAD_DIR/$stored_name"
  mkdir -p "$SNAPSHOT_DOWNLOAD_DIR"
  if ! download_snapshot_archive "$url" "$path" "$label"; then
    return 1
  fi
  if ! extract_lz4_tar_to "$path" "$dest"; then
    warn "Extraction failed; leaving $path for inspection or resume"
    return 1
  fi
  if [[ $SNAPSHOT_KEEP_DOWNLOADS -eq 0 ]]; then
    rm -f "$path" "${path}.aria2" 2>/dev/null || true
  else
    info "Kept snapshot archive: $path"
    chown berachain:berachain "$path" 2>/dev/null || true
  fi
}

stream_extract() {
  local url="$1" dest="$2" description="$3"
  mkdir -p "$dest"
  curl -Lf "$url" | lz4 -d | tar -xf - -C "$dest"
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

  mkdir -p "$BIN_DIR" "$CL_HOME" "$EL_HOME" "$CONFIG_DIR" "$RUNTIME_DIR"
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
  local tag="${EL_VERSION:-}" repo="$REPO_RETH" url="" tmpdir match path
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
}

# ------------------------------
# Network files for EL init
# ------------------------------
construct_network_url() {
  local file="$1" chain_id="$2"
  echo "https://raw.githubusercontent.com/berachain/beacon-kit/main/testing/networks/${chain_id}/${file}"
}

fetch_network_files() {
  local chain_id file_url

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
# Instance storage provisioning
# ------------------------------
provision_instance_storage() {
  # If /opt is already a separate mountpoint, do nothing
  if mountpoint -q /opt; then
    info "/opt is already a dedicated mount; skipping instance storage provisioning"
    return 0
  fi

  # Enumerate EC2 instance-store devices by-id and choose the largest unmounted one
  local selected_dev="" max_size=0
  while IFS= read -r id; do
    local path size
    path="$(readlink -f "/dev/disk/by-id/${id}" 2>/dev/null || true)"
    [[ -b "$path" ]] || continue
    # Skip if mounted anywhere
    if findmnt -n -S "$path" >/dev/null 2>&1; then
      continue
    fi
    size="$(lsblk -bdno SIZE "$path" 2>/dev/null || echo 0)"
    if [[ "$size" =~ ^[0-9]+$ ]] && (( size > max_size )); then
      max_size=$size
      selected_dev="$path"
    fi
  done < <(ls -1 /dev/disk/by-id 2>/dev/null | grep -E '^nvme-Amazon_EC2_NVMe_Instance_Storage' || true)

  if [[ -z "$selected_dev" ]]; then
    info "No unmounted EC2 instance-store device found; skipping instance storage provisioning"
    return 0
  fi

  local dev="$selected_dev"

  info "Preparing instance storage device $dev for /opt"

  # Ensure required tools
  apt_install_if_missing e2fsprogs mkfs.ext4 || true
  apt_install_if_missing util-linux blkid || true

  # Safety: if device is already mounted (race), skip
  if findmnt -n -S "$dev" >/dev/null 2>&1; then
    info "Device $dev is already mounted; skipping instance storage provisioning"
    return 0
  fi

  # Force-create ext4 filesystem on the unmounted device (overwrites existing contents)
  info "Creating ext4 filesystem on $dev (force)"
  mkfs.ext4 -F "$dev" >/dev/null
  local fstype_to_use="ext4"

  local uuid
  uuid=$(blkid -o value -s UUID "$dev" 2>/dev/null || true)
  if [[ -z "$uuid" ]]; then
    err "Could not determine UUID for $dev; skipping /etc/fstab configuration"
    return 0
  fi

  mkdir -p /opt

  # Add to /etc/fstab if not present with high-performance options
  local mount_opts="defaults,noatime,nodiratime,discard=async,commit=60,nofail,x-systemd.device-timeout=10s"
  if ! grep -q "UUID=$uuid\s\+/opt\s" /etc/fstab 2>/dev/null; then
    info "Adding /opt mount to /etc/fstab"
    echo "UUID=$uuid /opt $fstype_to_use $mount_opts 0 2" >> /etc/fstab
  fi

  # Mount it now
  if ! mountpoint -q /opt; then
    if mount /opt; then
      info "Mounted $dev at /opt"
    else
      warn "Failed to mount $dev at /opt via fstab; attempting direct mount"
      mount -t "$fstype_to_use" "$dev" /opt || warn "Direct mount of $dev at /opt failed"
    fi
  fi
}

# ------------------------------
# Initialization (EL and CL)
# ------------------------------
init_el() {
  if [[ $EL_SNAPSHOT_INSTALLED -eq 1 ]]; then
    info "EL datadir already initialized by bera-reth download; skipping bera-reth init"
    return 0
  fi

  info "Initializing EL database from genesis..."
  # Display EL genesis md5 for verification
  if [[ -f "$CONFIG_DIR/el/genesis.json" ]]; then
    local _gen_md5
    _gen_md5=$(md5sum "$CONFIG_DIR/el/genesis.json" | awk '{print $1}')
    info "EL genesis md5: ${_gen_md5}"
  else
    warn "EL genesis not found at $CONFIG_DIR/el/genesis.json"
  fi


  if ! sudo -u berachain bash -c "cd '$EL_HOME' && '$BIN_DIR/bera-reth' init --datadir $EL_HOME/data --chain $CONFIG_DIR/el/genesis.json >/dev/null 2>&1"; then
    err "bera-reth init failed with exit code $?"
    exit 1
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
    if ! sudo -u berachain "$BIN_DIR/beacond" 2>/dev/null init "berachain-node" --chain-id "$chain_id" --home "$CL_HOME" --beacon-kit.chain-spec "$CHAIN"; then
      err "beacond init failed with exit code $?"
      exit 1
    fi
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
      # Pruning depends on mode: archive => nothing (matches cl-archive seed), pruned => default (matches cl-pruned seed)
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
  local reth_mode_flag=""
  if [[ "$MODE" != "archive" ]]; then reth_mode_flag="--full"; fi
  el_exec="$BIN_DIR/bera-reth"
  el_args="node --datadir $EL_HOME/data \
    --http --http.addr 0.0.0.0 --http.port $EL_HTTP_PORT \
    --ws --ws.addr 0.0.0.0 --ws.port $EL_WS_PORT \
    --authrpc.addr 127.0.0.1 --authrpc.port $EL_AUTHRPC_PORT --authrpc.jwtsecret $JWT_PATH \
    --port $EL_P2P_PORT --chain $CONFIG_DIR/el/genesis.json $bootnodes_arg $reth_mode_flag"

  # Append NAT external IP if available (advertise correct external address)
  NAT_IP=$(detect_external_ip)
  if [[ -n "$NAT_IP" ]]; then
    el_args+=" --nat extip:$NAT_IP"
  fi

  cat > "$SYSTEMD_DIR/$EL_SERVICE" <<UNIT
[Unit]
Description=Berachain Execution Layer (bera-reth)
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

  local cl_args="start --home $CL_HOME"

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
  bold "Berachain installer starting (storage v2)…"
  provision_instance_storage
  ensure_user_and_dirs
  install_beacond
  install_el
  fetch_network_files
  install_snapshots_v2
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
