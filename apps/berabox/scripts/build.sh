#!/bin/bash
# Berabox Build Script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BERABOX_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions and configuration
source "$SCRIPT_DIR/common.sh"

# Git operations for repository management

 

# Parse command line arguments
INSTALLATION=""
COMPONENTS=""
NO_PULL=false
QUIET=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --installation)
            INSTALLATION="$2"
            shift 2
            ;;
        --components)
            COMPONENTS="$2"
            shift 2
            ;;
        --no-pull)
            NO_PULL=true
            shift
            ;;
        --quiet)
            QUIET=true
            shift
            ;;
        -h|--help)
            echo "This script is called by the main bb command"
            exit 1
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ -z "$INSTALLATION" || -z "$COMPONENTS" ]]; then
    log_error "Missing required arguments"
    exit 1
fi

# Load installation configuration and versions
INSTALLATION_DIR="$BERABOX_ROOT/installations/$INSTALLATION"
INSTALLATION_TOML="$INSTALLATION_DIR/installation.toml"

if [[ ! -f "$INSTALLATION_TOML" ]]; then
    log_error "Installation '$INSTALLATION' not found. Expected: $INSTALLATION_TOML"
    exit 1
fi

# Ensure repositories match configuration (handles URL changes)
BB_CONFIG_INSTALLATIONS_DIR="$BERABOX_ROOT/installations"
if ! bb_ensure_repos_match_config "$INSTALLATION"; then
    log_error "Failed to ensure repositories match configuration"
    exit 1
fi

# Download a pre-built release binary from GitHub instead of building from source.
# Usage: download_release_binary <github_repo> <target_dir> <target_binary_name>
# Resolves the latest release tag via the GitHub API, downloads the linux-amd64
# asset, extracts it, and places the binary at <target_dir>/<target_binary_name>.
download_release_binary() {
    local repo="$1"
    local target_dir="$2"
    local target_name="$3"

    log_step "Resolving latest release for $repo..."
    local tag
    tag=$(curl -sfL "https://api.github.com/repos/berachain/$repo/releases/latest" \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
    if [[ -z "$tag" ]]; then
        log_error "Failed to resolve latest release tag for $repo"
        exit 1
    fi
    log_substep "Latest release: $tag"

    local asset_name=""
    case "$repo" in
        beacon-kit)  asset_name="beacond-${tag}-linux-amd64.tar.gz" ;;
        bera-reth)   asset_name="bera-reth-${tag}-x86_64-unknown-linux-gnu.tar.gz" ;;
        *)           log_error "No release asset pattern for $repo"; exit 1 ;;
    esac

    local url="https://github.com/berachain/$repo/releases/download/$tag/$asset_name"
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" RETURN

    log_step "Downloading $asset_name..."
    if ! curl -sfL "$url" -o "$tmp_dir/$asset_name"; then
        log_error "Download failed: $url"
        exit 1
    fi

    tar -xzf "$tmp_dir/$asset_name" -C "$tmp_dir"
    rm "$tmp_dir/$asset_name"

    local extracted
    extracted=$(find "$tmp_dir" -type f ! -name '*.txt' | head -1)
    if [[ -z "$extracted" ]]; then
        log_error "No binary found in release archive"
        exit 1
    fi

    chmod +x "$extracted"
    mv "$extracted" "$target_dir/$target_name"
    log_substep "✓ $target_name installed at $target_dir/$target_name (release $tag)"
}

# Function to read version from installation.toml
load_component_version() {
    local component="$1"
    local version=$(bb_parse_toml_value "$INSTALLATION_TOML" "$component")
    if [[ -z "$version" ]]; then
        log_error "No version specified for $component in installation.toml"
        log_error "Installation may be corrupted. Try recreating it with: ./berabox.sh create"
        exit 1
    fi
    echo "$version"
}

# Acquire exclusive build lock per installation
LOCK_FILE="$INSTALLATION_DIR/.build.lock"
LOCK_FD=200

acquire_lock() {
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        log_error "Another build is already in progress for installation '$INSTALLATION'"
        log_error "If you're sure no other build is running, remove: $LOCK_FILE"
        exit 1
    fi
    echo $$ > "$LOCK_FILE"
    log_info "Build lock acquired for '$INSTALLATION' (PID: $$)"
}

release_lock() {
    if [[ -n "${LOCK_FD:-}" ]]; then
        flock -u "$LOCK_FD" 2>/dev/null || true
        exec 200>&- 2>/dev/null || true
    fi
    rm -f "$LOCK_FILE" 2>/dev/null || true
    log_info "Build lock released for '$INSTALLATION'"
}

# Ensure lock is released on exit
trap release_lock EXIT INT TERM

acquire_lock

# Load paths from installation.toml
SRC_DIR=$(bb_get_installation_path "$INSTALLATION_TOML" "src_dir")

log_info "Building: $COMPONENTS"
log_info "Using source tree: $SRC_DIR"

# Convert components to array
IFS=',' read -ra COMPONENT_ARRAY <<< "$COMPONENTS"

for component in "${COMPONENT_ARRAY[@]}"; do
    case "$component" in
        "beacon-kit")
            BEACON_KIT_VERSION=$(load_component_version "beacon_kit")

            if [[ "$BEACON_KIT_VERSION" == "latest" ]]; then
                mkdir -p "$SRC_DIR/beacon-kit"
                download_release_binary "beacon-kit" "$SRC_DIR/beacon-kit" "beacond"
            else
                if [[ ! -d "$SRC_DIR/beacon-kit" ]]; then
                    log_error "beacon-kit source not found at $SRC_DIR/beacon-kit"
                    log_error "Run 'bb create' to set up per-installation source trees"
                    exit 1
                fi

                cd "$SRC_DIR/beacon-kit"

                log_substep "Switching beacon-kit to version: $BEACON_KIT_VERSION"
                bb_git_checkout_safe "$SRC_DIR/beacon-kit" "$BEACON_KIT_VERSION" "$NO_PULL"

                log_step "Building beacond (Go) from $BEACON_KIT_VERSION..."

                build_log=$(mktemp)
                go_output=""
                [[ "$QUIET" == "true" ]] && go_output=">/dev/null"

                binary_name="beacond"

                if eval go build -o "$binary_name" ./cmd/beacond 2> "$build_log" $go_output; then
                    rm -f "$build_log"
                    log_substep "✓ $binary_name built at $(pwd)/$binary_name"
                else
                    log_error "Failed to build $binary_name:"
                    tail -10 "$build_log" | sed 's/^/    /'
                    rm -f "$build_log"
                    exit 1
                fi
            fi
            ;;
            
        "bera-reth")
            BERA_RETH_VERSION=$(load_component_version "bera_reth")

            if [[ "$BERA_RETH_VERSION" == "latest" ]]; then
                mkdir -p "$SRC_DIR/bera-reth"
                download_release_binary "bera-reth" "$SRC_DIR/bera-reth" "reth"
            else
                if [[ ! -d "$SRC_DIR/bera-reth" ]]; then
                    log_error "bera-reth source not found at $SRC_DIR/bera-reth"
                    log_error "Run 'bb create' to set up per-installation source trees"
                    exit 1
                fi

                cd "$SRC_DIR/bera-reth"

                log_substep "Switching bera-reth to version: $BERA_RETH_VERSION"
                bb_git_checkout_safe "$SRC_DIR/bera-reth" "$BERA_RETH_VERSION" "$NO_PULL"

                cargo_flags=""
                binary_path="target/release/bera-reth"
                binary_name="reth"

                [[ "$QUIET" == "true" ]] && cargo_flags="$cargo_flags --quiet"

                log_step "Building bera-reth (Cargo --release) from $BERA_RETH_VERSION..."

                cargo build --release --bin bera-reth $cargo_flags

                cp "$binary_path" "$binary_name"
                log_substep "✓ $binary_name built at $(pwd)/$binary_name"
            fi
            ;;
            
        *)
            log_error "Unknown component: $component"
            log_warn "Valid components: beacon-kit, bera-reth"
            exit 1
            ;;
    esac
done

log_info "Binaries built in-place; no bin directory used"
log_info "Next steps: init → install → start"
