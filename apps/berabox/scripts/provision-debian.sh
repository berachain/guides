#!/bin/bash
set -euo pipefail

# Source common functions for debug control
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Always show critical information
echo "🐻 Setting up Berabox Debian Development Environment..."
debug_echo "📡 Using anonymous HTTPS git checkouts (no authentication required)"
debug_echo ""

# Determine the actual user if running via sudo
if [ "$EUID" -eq 0 ]; then
    if [ -n "$SUDO_USER" ]; then
        ACTUAL_USER="$SUDO_USER"
        ACTUAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
        debug_echo "🔧 Running as root, setting up for user: $ACTUAL_USER"
    else
        echo "❌ Script should be run as regular user or via sudo"
        exit 1
    fi
else
    ACTUAL_USER="$USER"
    ACTUAL_HOME="$HOME"
    debug_echo "🔧 Running as user: $ACTUAL_USER"
fi

debug_echo ""

# Remove CD-ROM from apt sources (common on fresh Debian installs)
debug_echo "💿 Removing CD-ROM from apt sources..."
sudo sed -i '/deb cdrom/d' /etc/apt/sources.list
sudo sed -i '/deb-src cdrom/d' /etc/apt/sources.list

# Update package lists
debug_echo "📦 Updating package lists..."
run_quiet sudo apt-get update

# Install essential development tools
echo "📦 Installing 25 core development packages (curl, git, build-essential, clang, cmake, etc.)..."
run_quiet sudo apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libc6-dev \
    gcc \
    g++ \
    make \
    cmake \
    unzip \
    jq \
    systemd \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    libclang-dev \
    clang \
    figlet \
    multitail \
    miniupnpc 

# Install official Grafana OSS release
echo "📊 Installing Grafana OSS + Prometheus + Node Exporter (3 monitoring tools)..."
if command -v grafana-server >/dev/null 2>&1; then
    debug_echo "✅ Grafana already installed, skipping"
else
    debug_echo "📦 Adding Grafana repository and installing..."
    sudo mkdir -p /etc/apt/keyrings/
    temp_file=$(mktemp)
    wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg >"$temp_file" 2>&1
    echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list >"$temp_file" 2>&1
    rm -f "$temp_file"
    run_quiet sudo apt-get update
    run_quiet sudo apt-get install -y grafana prometheus prometheus-node-exporter
    run_quiet sudo systemctl daemon-reload
    run_quiet sudo systemctl enable grafana-server
    run_quiet sudo systemctl start grafana-server
    run_quiet sudo systemctl enable prometheus
    run_quiet sudo systemctl start prometheus
    run_quiet sudo systemctl enable prometheus-node-exporter
    run_quiet sudo systemctl start prometheus-node-exporter
    debug_echo "✅ Grafana OSS installed, enabled, and started"
fi

# Install Go 1.21+ in /opt
echo "🐹 Installing Go 1.25 compiler + runtime to /opt/go..."
GO_VERSION="1.25.0"
INSTALL_GO=false
if [[ -f /opt/go/bin/go ]]; then
    CURRENT_GO_VERSION=$(/opt/go/bin/go version | cut -d' ' -f3 | sed 's/go//')
    if [[ "$CURRENT_GO_VERSION" == "$GO_VERSION" ]]; then
        debug_echo "✅ Go $GO_VERSION already installed, skipping"
    else
        debug_echo "⚠️  Go $CURRENT_GO_VERSION found, but $GO_VERSION requested. Updating..."
        INSTALL_GO=true
    fi
else
    debug_echo "📦 Go not found, installing..."
    INSTALL_GO=true
fi

if [[ "$INSTALL_GO" == "true" ]]; then
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ]; then
        GO_ARCH="arm64"
    elif [ "$ARCH" = "x86_64" ]; then
        GO_ARCH="amd64"
    else
        debug_echo "⚠️  Unknown architecture: $ARCH, defaulting to amd64"
        GO_ARCH="amd64"
    fi

    debug_echo "Downloading Go ${GO_VERSION} for ${GO_ARCH}..."
    run_quiet wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    run_quiet sudo rm -rf /opt/go
    run_quiet sudo tar -C /opt -xzf "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    rm "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    debug_echo "✅ Go $GO_VERSION installed"
fi

# Install Rust 1.70+ system-wide in /opt
echo "🦀 Installing Rust toolchain (rustup + cargo) system-wide to /opt/rust..."
if [[ -f /opt/rust/.cargo/bin/rustc ]]; then
    debug_echo "✅ Rust already installed, skipping installation"
else
    debug_echo "📦 Rust not found, installing..."
    sudo mkdir -p /opt/rust
    export RUSTUP_HOME=/opt/rust/.rustup
    export CARGO_HOME=/opt/rust/.cargo
    temp_file=$(mktemp)
    curl -sSf https://sh.rustup.rs | sudo RUSTUP_HOME=/opt/rust/.rustup CARGO_HOME=/opt/rust/.cargo sh -s -- -y --default-toolchain stable --profile default --no-modify-path >"$temp_file" 2>&1
    if [[ $? -ne 0 && "${BB_DEBUG:-false}" != "true" ]]; then
        echo "Rust installation failed:" >&2
        cat "$temp_file" >&2
    fi
    rm -f "$temp_file"
    sudo chmod -R 755 /opt/rust
    debug_echo "✅ Rust installed"
fi

# Add Go and Rust to system-wide environment
debug_echo "🔧 Configuring system-wide Go and Rust environment..."
if [[ -f /etc/profile.d/go-rust-env.sh ]]; then
    debug_echo "⚠️  /etc/profile.d/go-rust-env.sh already exists, skipping to preserve existing configuration"
else
    temp_file=$(mktemp)
    sudo tee /etc/profile.d/go-rust-env.sh >"$temp_file" 2>&1 << 'EOF'
# Go environment
export PATH=/opt/go/bin:$PATH
export GOPATH=$HOME/go
export PATH=$GOPATH/bin:$PATH

# Rust environment (system-wide binaries, user-specific cache/registry)
export RUSTUP_HOME=/opt/rust/.rustup
export PATH=/opt/rust/.cargo/bin:$PATH
# Use user's home directory for cargo cache and git dependencies
export CARGO_HOME=$HOME/.cargo

# Add current directory to PATH for convenience
export PATH=.:$PATH
EOF
    rm -f "$temp_file"
    debug_echo "✅ Created /etc/profile.d/go-rust-env.sh"
fi

# Make the profile script executable
sudo chmod +x /etc/profile.d/go-rust-env.sh

# Install additional tools for debugging and development
echo "🔍 Installing 30+ debugging tools (gdb, valgrind, strace, htop, lldb, perf, network tools)..."
run_quiet sudo apt-get install -y \
    gdb \
    glibc-source \
    valgrind \
    strace \
    htop \
    tree \
    vim \
    nano \
    tmux \
    screen \
    lldb \
    perf-tools-unstable \
    binutils \
    tcpdump \
    netcat-openbsd \
    lsof \
    psmisc \
    procps \
    net-tools \
    iputils-ping \
    dnsutils \
    telnet \
    rsync \
    zip \
    unzip \
    bzip2 \
    lz4 \
    figlet \
    multitail \
    xz-utils

# Install Rust development tools
echo "🦀 Installing Rust toolchain components (rustfmt, clippy, rust-src, rust-analyzer) + cargo tools..."
export RUSTUP_HOME=/opt/rust/.rustup
export CARGO_HOME=/opt/rust/.cargo
export PATH=/opt/rust/.cargo/bin:$PATH

# Check if Rust components are already installed
if sudo RUSTUP_HOME=/opt/rust/.rustup CARGO_HOME=/opt/rust/.cargo /opt/rust/.cargo/bin/rustup component list --installed | grep -q "rustfmt\|clippy\|rust-src\|rust-analyzer"; then
    debug_echo "✅ Rust components already installed, skipping"
else
    debug_echo "📦 Installing Rust components..."
    run_quiet sudo RUSTUP_HOME=/opt/rust/.rustup CARGO_HOME=/opt/rust/.cargo /opt/rust/.cargo/bin/rustup component add rustfmt clippy rust-src rust-analyzer
fi

# Check if cargo tools are already installed
if [[ -f /opt/rust/.cargo/bin/cargo-edit ]] && [[ -f /opt/rust/.cargo/bin/cargo-watch ]] && [[ -f /opt/rust/.cargo/bin/cargo-expand ]]; then
    debug_echo "✅ Rust cargo tools already installed, skipping"
else
    debug_echo "📦 Installing Rust cargo tools..."
    run_quiet sudo RUSTUP_HOME=/opt/rust/.rustup CARGO_HOME=/opt/rust/.cargo /opt/rust/.cargo/bin/cargo install cargo-edit cargo-watch cargo-expand
fi

# Install Go development tools using modules (modern approach)
echo "🐛 Installing Go development tools (delve debugger, gopls, goimports, golangci-lint, staticcheck)..."
export PATH=/opt/go/bin:$PATH

# Check if Go tools are already installed (check a few key ones)
GO_TOOLS_EXIST=false
if command -v dlv >/dev/null 2>&1 && command -v gopls >/dev/null 2>&1 && command -v staticcheck >/dev/null 2>&1; then
    debug_echo "✅ Go development tools already installed, skipping"
    GO_TOOLS_EXIST=true
fi

if [[ "$GO_TOOLS_EXIST" == "false" ]]; then
    debug_echo "📦 Installing Go development tools..."
    # Create a temporary directory for installing tools
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"

    # Initialize a temporary module for installing tools
    run_quiet /opt/go/bin/go mod init tools
    run_quiet /opt/go/bin/go install github.com/go-delve/delve/cmd/dlv@latest
    run_quiet /opt/go/bin/go install golang.org/x/tools/cmd/goimports@latest
    run_quiet /opt/go/bin/go install golang.org/x/tools/cmd/godoc@latest
    run_quiet /opt/go/bin/go install golang.org/x/tools/gopls@latest
    run_quiet /opt/go/bin/go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
    run_quiet /opt/go/bin/go install honnef.co/go/tools/cmd/staticcheck@latest

    # Clean up temporary directory
    cd /
    rm -rf "$TEMP_DIR"

    debug_echo "✅ Go tools installed in \$GOPATH/bin (will be in user's ~/go/bin)"
fi

# Extract glibc sources for ARM64 debugging
debug_echo "🔧 Setting up glibc sources for ARM64 debugging..."
if [ -f /usr/src/glibc/glibc-*.tar.xz ]; then
    cd /usr/src/glibc
    temp_file=$(mktemp)
    sudo tar -xf glibc-*.tar.xz >"$temp_file" 2>&1 || true
    rm -f "$temp_file"
    debug_echo "✅ glibc sources extracted (fixes ARM64 debugging 'No such file' errors)"
else
    debug_echo "⚠️  glibc source tarball not found - debugging may show source path warnings"
fi

echo ""
echo "🎉 Development environment setup complete"
echo "   📦 Installed ~60 packages: 25 core dev tools + 30+ debug tools + Go/Rust toolchains"
debug_echo "🐛 ARM64 debugging is configured with glibc sources"

