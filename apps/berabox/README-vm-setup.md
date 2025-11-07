# 🖥️ Berabox VM Development Setup

This guide covers setting up an isolated virtual machine development environment for Berabox using UTM on Apple Silicon.

## Isolated VM Development with UTM

For developers who want to experiment with berabox in a completely isolated virtual machine environment on Apple Silicon:

### 1. Install UTM

Download from [https://mac.getutm.app](https://mac.getutm.app)

### 2. Download Debian 12 ARM64 ISO

```bash
# Download Debian 12 (Bookworm) ARM64 netinstall image
wget https://cdimage.debian.org/cdimage/release/current/arm64/iso-dvd/debian-12.11.0-arm64-DVD-1.iso
```

### 3. Create and Configure UTM VM

1. **Open UTM** → "Create a New Virtual Machine"
2. **Choose "Virtualize"** (for ARM64 performance)
3. **Select "Other"** as operating system
4. **Configure VM:**
   - Memory: 8192 MB (8GB) 
   - CPU Cores: 4
   - Storage: 1TB recommended (it is lazy-allocated)
5. **Configure Shared Folders:**
   - Select your local berabox directory (e.g., `/Users/username/src/berabox`)
6. **Boot from ISO:**
   - Add the downloaded ISO as removable drive
   - Boot and install Debian. Accept all defaults.
   - After the final reboot, disconnect the ISO.
7. **Finish installation and reboot**
   - Log into the machine, and type 'ip addr'. This will show your IP. SSH in from the Mac terminal.

### 4. Set Up Shared Folder Access

Set up access to your shared berabox folder:

```bash
su 
apt install sudo
echo "$LOGNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$LOGNAME
echo "share /mnt/ virtiofs defaults 0 0" | sudo tee -a /etc/fstab
systemctl daemon-reload
mount /mnt/
```

### 5. Provision Development Dependencies

Log back in to enable your sudo access, then:
```bash
sudo /mnt/berabox/scripts/provision-debian.sh
```

### 6. Set Up Development Environment & Verify Installation

Log out then back in to reload your working environment and paths, then:
```bash
ln -sf /mnt/berabox
cd berabox
sudo chown -R $USER .
go version          # Should show Go 1.21+
rustc --version     # Should show Rust 1.70+
cargo --version     # Rust package manager

bb --help           # Should show berabox help
```

### 7. Launch Sample Installation

```bash
bb create testnet reth
bb bb-testnet-reth build
bb bb-testnet-reth init
bb bb-testnet-reth install
bb bb-testnet-reth start
```

## Benefits of VM Development

- **Complete isolation** from your host system
- **Reproducible environment** for testing and development
- **Safe experimentation** without affecting your main development setup
- **ARM64 performance** optimization on Apple Silicon
- **Shared folder access** for seamless development workflow
