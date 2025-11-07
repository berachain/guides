# 🐻 Berabox - Multi-User Node Management

Multi-user, multi-installation, debug-first node management for Beacon-Kit + Bera-Reth/Geth. Each user gets their own isolated berabox in their home directory with automatic port allocation and debug configurations.

## Features

- **🏠 Per-User Isolation**: Each user operates independently in their home directory with automatic user prefixing
- **📊 Per-Installation Versioning**: Independent component versions in each installation
- **🧊 Complete Instance Isolation**: Each installation has its own binaries, data, configuration, and logs—no sharing, no cross-contamination, not even if you bribe the sysadmin with cookies!
- **🔌 Automatic Port Management**: User ID-based port ranges prevent conflicts between users
- **🐛 Debug-First Design**: Always builds debug binaries (Go: full symbols, Rust: unoptimized debug)
- **⚙️ VS Code Integration**: Auto-generates debug configurations and workspace

## Architecture

```
~/berabox/                     # User's personal berabox
├── installations/             # User-prefixed installations
│   ├── bb-testnet-geth/       # Automatic user prefix (bb = username)
│   │   ├── data/cl|el/        # Separate CL/EL data & config
│   │   ├── logs/cl|el/        # Separate CL/EL logs
│   │   ├── systemd/           # Generated user service files
│   │   ├── runtime/           # Runtime files
│   │   │   └── ipc/           # IPC sockets (geth.ipc, reth.ipc)
│   │   ├── src/               # Per-installation source code & debug binaries
│   │   │   ├── beacon-kit/    # Installation-specific beacon-kit clone (with beacond-debug)
│   │   │   └── bera-geth/     # Installation-specific bera-geth clone (with geth-debug)
│   │   └── installation.toml  # Installation metadata & versions
│   └── bb-mainnet-reth/       # Independent second installation
│       ├── data/cl|el/        # Independent data
│       ├── src/               # Independent source code & debug binaries
│       │   ├── beacon-kit/    # Independent beacon-kit clone (with beacond-debug)
│       │   └── bera-reth/     # Independent bera-reth clone (with reth-debug)
│       └── installation.toml  # Independent configuration
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

bb create testnet reth
bb bb-testnet-reth info
bb bb-testnet-reth version set --cl v1.3.1 --el v1.0.1
bb bb-testnet-reth build
bb bb-testnet-reth init
bb bb-testnet-reth install
bb bb-testnet-reth start
bb bb-testnet-reth logs
bb bb-testnet-reth attach

bb debug
code bb-berabox.code-workspace

bb create mainnet geth && bb create testnet reth
bb bb-mainnet-geth version set --cl v1.3.2 --el v1.19.5
bb bb-testnet-reth version set --cl v1.4.0-rc1 --el v1.20.0-rc5
bb build
bb init
bb install
bb start
```

## Commands

### Setup Commands

**`create <chain> <el-client> [name] [--port-base <port>]`** - Create a new installation

- `chain`: `mainnet` or `testnet`
- `el-client`: `reth` or `geth`
- `name`: Optional custom name (defaults to `{chain}-{el-client}`, gets user prefix)

**`list`** - Show all installations with status summary

**`debug`** - Generate debug configs and workspace for all installations

**`help` / `-h` / `--help`** - Show command help

### Installation Commands

**`[installation] info`** - Show installation information

Displays detailed information about an installation including versions, service status, port allocations, validator keys (if CL is initialized), and the execution layer enode (if EL is running). The validator keys include the CometBFT validator address and public key along with the Ethereum/Beacon pubkey used for block proposals. The enode is retrieved directly from the running execution layer via IPC and can be shared for P2P peering.

**`[installation] build [--no-pull] [--quiet] [clean]`** - Build binaries

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

**`<installation> version set --cl <version> --el <version>`** - Set component versions

**`<installation> version show-tags`** - Show available Git tags and branches

**`<installation> status [cl|el]`** - Show service status

**`<installation> logs [cl|el]`** - Follow service logs with multitail

- Exit: Press `Ctrl+C`, Switch windows: `<Tab>`, Scroll: arrow keys, Search: `/`, Pause: `b`, Help: `h`

**`<installation> attach`** - Attach geth console to running EL (works with geth or reth via IPC)

- Requires a geth installation to provide the console used for attachment

**`<installation> remove`** - Remove installation completely

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

**Automatic Port Conflict Avoidance**: BeraBox automatically detects port conflicts with existing installations and system services. When creating a new installation, if the requested port base conflicts with existing ports, BeraBox automatically bumps the port base by 20 until it finds a clear range. This ensures installations never have port conflicts and can be created seamlessly.

### `installation.toml`

Each installation has an `installation.toml` file that contains all configuration including ports, paths, and component versions. Noteworthy things in there:

```
[options]
archive_mode = false

[identity]
cl_key_name = ""
el_key_name = ""

[upnp]
enabled = false
lease_time = 86400
```

- `cl_key_name`: The name of the consensus layer validator key to use for signing blocks and attestations. If left blank, the node will not run as a validator (it will operate in non-validator mode, just observing the chain and producing metrics, but not proposing or voting on blocks). Set this to the name of a key you have generated or imported. Place it in `keep/cl-keys/<cl_key_name>.json`

- `el_key_name`: The name of the execution layer node key to preserve ENODE identity across rebuilds. If left blank, a random key is generated. This ensures your published mainnet ENODEs remain predictable for peer connections. Place keys in `keep/el-keys/<el_key_name>.nodekey`

- `upnp.enabled`: Enable UPnP automatic port forwarding for P2P ports (improves network connectivity). Forwards both TCP and UDP protocols on P2P ports only, never RPC or admin ports. Requires router/gateway with UPnP support. The lease is obtained when you install, and released when you uninstall. Default: false

- `upnp.lease_time`: Port forwarding lease time in seconds. 86400 = 24 hours, 0 = permanent mapping. Default: 86400

## Debugging

Berabox is designed debug-first with full VS Code integration and automatic configuration generation.

**Debug builds include full symbols**: Go (`-gcflags="all=-N"`), Rust (unoptimized debug).

### VS Code/Cursor Debugging

Berabox provides comprehensive VS Code/Cursor debugging with remote debugging capabilities, process attachment via PID selection, and an integrated workspace that includes all source code and installations.

**Generate debug workspace for all installations**:

```bash
bb debug
code bb-berabox.code-workspace
cursor bb-berabox.code-workspace
```

**Debug configurations are pre-configured for**:

- **Process Attachment**: Attach debugger to running CL/EL processes via PID selection
- **Launch Debugging**: Start processes directly in debug mode with wait-for-debugger

**Generated debug files**:

- `bb-berabox.code-workspace` - Multi-folder workspace with all installations and source code
- `.vscode/launch.json` - Launch configurations for attaching/launching CL/EL processes

**Debug workflow**:

```bash
bb bb-testnet-reth start
bb debug
code bb-berabox.code-workspace
```

**Debugging Modes**:

The debug system configures VS Code to attach to running processes using their debug symbols, enabling seamless debugging of beacon-kit, bera-reth, and bera-geth. Some Cursor/VS Code plugins are required; choose wisely.

- **Process Attachment**: Attach the VS Code/Cursor debugger to a running process—`beacond-debug` (CL/beacon-kit) via PID selection, `reth-debug` (EL/reth) via lldb, or `geth-debug` (EL/geth) via dlv. VS Code/Cursor lists relevant processes for easy attachment. (Just don’t get too attached, or you might start debugging your own life choices.)
- **Startup Launch Debugging**: Launch CL/EL processes directly in the debugger for startup and initialization debugging. Berabox automatically stops any running services before launching in debug mode to prevent port conflicts—because two processes fighting over a port is a real socket drama.

### Monitoring

For comprehensive monitoring setup with Prometheus and Grafana, see [README-monitoring.md](README-monitoring.md).

### User Service Logs

```bash
bb bb-testnet-reth status cl
bb bb-testnet-reth logs cl
bb bb-testnet-reth attach
multitail installations/bb-testnet-reth/logs/*/*.log
```

### Geth Console Attachment

The `attach` command uses a clever cross-client compatibility trick: **any geth binary can attach to any execution layer client** (whether geth or reth) via IPC.

**How it works:**

1. Berabox finds any available `geth` binary (from any installation or system PATH)
2. Uses it to connect via IPC to the target installation's execution layer
3. Provides full JavaScript console access regardless of the underlying EL client

```
# Inside any console session:
eth.blockNumber               # Current block height
net.peerCount                # Number of connected peers
txpool.status                # Transaction pool status
admin.nodeInfo               # Node information
```

## Development Environment

### VM Development Setup

For isolated VM development with UTM on Apple Silicon, see [README-vm-setup.md](README-vm-setup.md).

---

_Built with ❤️ (and debugging symbols) for Berachain_
