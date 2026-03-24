# 🐻 Berabox

Multi-installation node management for Beacon-Kit + Bera-Reth. Each user gets an isolated berabox with automatic port allocation, per-installation versioning, and debug configurations. Every installation carries its own binaries, data, config, and logs -- nothing is shared.

Builds produce debug binaries by default (Go with full symbols, Rust unoptimized). VS Code/Cursor debug configurations are auto-generated.

## Architecture

```
~/berabox/                     # User's personal berabox
├── installations/             # User-prefixed installations
│   ├── bb-testnet-reth/       # Automatic user prefix (bb = username)
│   │   ├── data/cl|el/        # Separate CL/EL data & config
│   │   ├── logs/cl|el/        # Separate CL/EL logs
│   │   ├── systemd/           # Generated user service files
│   │   ├── runtime/           # Runtime files (IPC sockets, etc.)
│   │   ├── src/               # Per-installation source code & binaries
│   │   │   ├── beacon-kit/    # Installation-specific beacon-kit clone (with beacond)
│   │   │   └── bera-reth/     # Installation-specific bera-reth clone (with reth)
│   │   └── installation.toml  # Installation metadata & versions
│   └── bb-mainnet-reth/       # Independent second installation
│       ├── data/cl|el/        # Independent data
│       ├── src/               # Independent source code & binaries
│       │   ├── beacon-kit/    # Independent beacon-kit clone (with beacond)
│       │   └── bera-reth/     # Independent bera-reth clone (with reth)
│       └── installation.toml  # Independent configuration
├── keep/                      # Persistent identity keys (survive reset/init)
│   ├── cl-keys/               # CL validator + P2P node keys (.json)
│   └── el-keys/               # EL discovery keys (.nodekey)
├── debug/                     # Auto-generated debug configs
│   └── vscode/                # VS Code launch configurations
├── bb-berabox.code-workspace  # VS Code workspace
├── scripts/                   # Management scripts
├── templates/                 # Service and config templates
└── bb                         # Main interface
```

## Quick Start

```bash
cd ~
git clone https://github.com/berachain/berabox.git
cd berabox

bb create mainnet reth
bb bb-mainnet-reth version set --cl latest --el latest
bb bb-mainnet-reth build
bb bb-mainnet-reth init
bb bb-mainnet-reth install
bb bb-mainnet-reth start
bb bb-mainnet-reth logs
```

## Commands

### Setup Commands

**`create <chain> <el-client> [name] [--port-base <port>]`** - Create a new installation

- `chain`: `mainnet` or `testnet`
- `el-client`: `reth`
- `name`: Optional custom name (defaults to `{chain}-{el-client}`, gets user prefix)

**`list`** - Show all installations with status summary

**`debug`** - Generate debug configs and workspace for all installations

**`help` / `-h` / `--help`** - Show command help

### Installation Commands

**`[installation] info`** - Show installation information (versions, ports, service status, validator keys, enode)

**`[installation] build [--no-pull] [--quiet] [clean]`** - Build or fetch binaries

If the component version in `installation.toml` is set to `"latest"`, build downloads the most recent GitHub release binary instead of compiling from source. Otherwise it compiles from the checked-out source tree (Go default flags for beacond, Cargo `--release` for reth).

- `--no-pull`: Skip git pull before switching branches (default: always pull)
- `--quiet`: Silence compiler output while keeping operational logging
- `clean`: Remove build artifacts (preserves installed binaries)

**`[installation] init`** - Initialize network parameters

**`[installation] install`** - Install systemd services and configure UPnP port forwarding (no sudo required)

**`[installation] start [cl|el]`** - Start services

**`[installation] stop [cl|el]`** - Stop services

**`[installation] restart [cl|el]`** - Restart services

**`[installation] uninstall`** - Remove systemd services and clean up UPnP port forwarding (preserves data)

**`[installation] autostart`** - Enable autostart on system boot (requires sudo)

**`[installation] autostop`** - Disable autostart on system boot

**`[installation] reset [--force]`** - Reset installation(s) - stop services and wipe data

- `bb reset` - Reset ALL installations
- `bb <installation> reset` - Reset specific installation

**`<installation> version set --cl <version> --el <version>`** - Set component versions. Accepts a git tag, branch name, or `latest` (download pre-built release binary on next build).

**`<installation> version show-tags`** - Show available Git tags and branches

**`<installation> status [cl|el]`** - Show service status

**`<installation> logs [cl|el]`** - Follow service logs with multitail

- Exit: Press `Ctrl+C`, Switch windows: `<Tab>`, Scroll: arrow keys, Search: `/`, Pause: `b`, Help: `h`

**`<installation> attach`** - Attach reth-console to running EL via IPC

- Requires `reth-console` ([github.com/camembera/reth-console](https://github.com/camembera/reth-console))

**`<installation> remove`** - Remove installation completely

**`<installation> snapshot [--skip-el]`** - Restore CL/EL snapshots. Stops services, streams the latest snapshot from the Berachain snapshot index (lz4, zero intermediate copies), and respects `archive_mode` to pick the right snapshot type. Use `--skip-el` for CL-only restore. Override the index URL with `SNAPSHOT_INDEX_URL`.

## Configuration

### Multi-User Port Allocation

**Automatic user-scoped allocation** prevents conflicts between users:

- Each user gets 200-port range: `20000 + (user_id % 200) * 200`
- Each installation gets 20 sequential ports within user range (allows 10 installations per user)

**Port Layout (within each installation's 20-port block)**
| Offset | Service | Description | Final Digit |
|--------|---------|-------------|-------------|
| +0 | CL RPC | Consensus layer RPC | 0 |
| +1 | CL P2P | Consensus layer P2P | 1 |
| +3 | CL Prometheus | CL metrics | 3 |
| +4 | CL PProf | CL profiling | 4 |
| +5 | CL Node API | BeaconKit Node API | 5 |
| +10 | EL RPC | Execution layer JSON-RPC (HTTP) | 0 |
| +11 | EL P2P | Execution layer P2P | 1 |
| +12 | EL AuthRPC | EL Engine API (JWT) | 2 |
| +13 | EL Prometheus | EL metrics | 3 |
| +15 | EL WebSockets | Execution layer JSON-RPC (WS) | 5 |

Use `bb info` for all installations or `bb <installation> info` for specific installation details to see port allocations.

Port conflicts are detected automatically at creation time; the base is bumped by 20 until a clear range is found.

### `installation.toml` Reference

Every installation is fully described by a single `installation.toml`. The file is created by `bb create` and consumed by every other command. You can edit it directly; there is no separate config layer. Sections are listed below in the order they appear.

**`[installation]`** -- Identity metadata, set at creation time.

| Key | Example | Description |
|-----|---------|-------------|
| `name` | `"bb-mainnet-reth"` | Installation name (user-prefixed by `create`) |
| `chain` | `"mainnet"` | Network: `mainnet` or `testnet` |
| `el_client` | `"reth"` | Execution-layer client |
| `created` | `"2026-01-13T21:46:11+01:00"` | ISO-8601 creation timestamp |

**`[ports]`** -- Port allocations. `base_port` is the anchor; the rest are derived from it by fixed offsets (see port layout table above). You normally only set `base_port` via `--port-base` at creation time and leave the rest alone.

**`[paths]`** -- Absolute paths to every directory the installation uses (`installation_dir`, `src_dir`, `cl_data_dir`, `el_data_dir`, `cl_config_dir`, `el_config_dir`, `cl_logs_dir`, `el_logs_dir`). Set at creation time; only edit if you physically relocate directories.

**`[versions]`** -- Component versions used by `build`.

```toml
[versions]
beacon_kit = "v1.3.6"
bera_reth = "v1.3.1"
```

Each value can be a git tag, a branch name, or the special string `"latest"`. When set to `latest`, `bb build` skips the source checkout and compilation entirely and instead downloads the most recent GitHub release binary for that component (linux-amd64). This is much faster than a debug build and useful for production deployments or quick testing.

Set versions with `bb <installation> version set --cl <ver> --el <ver>`.

**`[repositories]`** -- Optional. Override the default GitHub clone URLs for CL and EL source trees. Useful for testing forks or private repos. When you change a URL, the next `build` or `version show-tags` detects the mismatch, removes the stale checkout, and clones the new one automatically.

```toml
[repositories]
cl_repo = "https://github.com/berachain/beacon-kit.git"
el_repo = "https://github.com/berachain/bera-reth.git"
```

Installations created without this section use the defaults above. Changing a URL destroys the local checkout, so commit any local work first.

**`[options]`**

| Key | Default | Description |
|-----|---------|-------------|
| `archive_mode` | `false` | `true` keeps all historical state (full archive); `false` prunes. Archive nodes use significantly more disk. |
| `storage_v2` | `false` | Use reth's V2 storage engine. Adds `--storage.v2` to reth CLI args. Requires fresh sync — do not enable on an existing datadir. |
| `el_log_verbosity` | `""` | EL log verbosity. Empty = reth default (info). Use `"v"`, `"vv"`, `"vvv"`, `"vvvv"` for increasing detail, `"q"` for quiet. |
| `el_log_filter` | `""` | EL log filter (`env_filter` directive for `--log.stdout.filter`). Example: `"info,reth::engine=debug"`. |

**`[identity]`** -- Persistent P2P identity keys, preserved across `init` cycles so your node ID and enode stay stable.

| Key | Description |
|-----|-------------|
| `cl_key_name` | Name of the CL validator signing key. Looked up as `keep/cl-keys/<name>.json` (`priv_validator_key.json`) and optionally `<name>.node_key.json` (CometBFT P2P identity). Leave blank to use ephemeral keys from `beacond init`. |
| `el_key_name` | Name of the EL node key. Looked up as `keep/el-keys/<name>.nodekey` (`discovery-secret`). Leave blank for a random key each init. Setting this keeps your published enode stable for peer connections. |

**`[peers]`** -- Persistent peers injected into CL `config.toml` and EL command-line arguments at init time. CL peers use CometBFT `node_id@host:port` format; EL peers use `enode://` URLs.

```toml
[peers]
cl_persistent_peers = [
  "7f402e44...@95.217.193.152:42301"
]
el_persistent_peers = [
  "enode://2ec46b2e...@95.217.193.152:42311"
]
```

**`[upnp]`** -- Automatic UPnP port forwarding for P2P ports only (never RPC or admin ports). The lease is obtained on `install` and released on `uninstall`.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Enable UPnP. Requires a gateway that supports it. |
| `lease_time` | `86400` | Lease duration in seconds (86400 = 24h, 0 = permanent). |

## Debugging

`bb debug` generates a VS Code/Cursor workspace (`bb-berabox.code-workspace`) and `.vscode/launch.json` with two modes:

- **Process Attachment** -- attach to a running `beacond` (Go, PID selection) or `reth` (Rust, lldb).
- **Startup Launch** -- launch CL/EL directly in the debugger. Berabox stops running services first to prevent port conflicts.

```bash
bb <installation> start
bb debug
code bb-berabox.code-workspace
```

### Monitoring

For comprehensive monitoring setup with Prometheus and Grafana, see [README-monitoring.md](README-monitoring.md).

### User Service Logs

```bash
bb bb-testnet-reth status cl
bb bb-testnet-reth logs cl
bb bb-testnet-reth attach
multitail installations/bb-testnet-reth/logs/*/*.log
```

### EL Console Attachment

The `attach` command uses [reth-console](https://github.com/camembera/reth-console) to connect to the running execution layer via IPC. It provides direct RPC invocation with a REPL, history, and a compact JSON query language -- no JS runtime or web3 object model.

Install from source (requires Rust toolchain):

```bash
git clone https://github.com/camembera/reth-console.git
cd reth-console
make all
cp target/debug/reth-console ~/.cargo/bin/
```

Usage outside berabox:

```bash
reth-console --datadir /path/to/reth
reth-console --exec "eth.blockNumber"
```

## Development Environment

### VM Development Setup

For isolated VM development with UTM on Apple Silicon, see [README-vm-setup.md](README-vm-setup.md).

---

_Built with ❤️ (and debugging symbols) for Berachain_
