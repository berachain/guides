# Snapshot Service Deployment Specification

This document is a production-grade deployment specification for the `apps/snapshot-service` package, written in an Ansible-playbook style but executable manually. It assumes the service code in this package is the source of truth and is already cloned on the target host.

The objective is to deploy a reproducible snapshot service for either Berachain Mainnet or Bepolia with explicit bootstrap, validation, idempotent reruns, and clear rollback points.

## 1. Scope

This spec deploys:

- snapshot generation and publish pipeline
- SQLite metadata database
- index/CSV/metrics generation
- cron scheduling
- static HTTPS serving
- environment-specific configuration (`mainnet` or `bepolia`)

This spec does not deploy:

- chain nodes themselves (berabox installations must already exist and sync)
- DNS provisioning
- TLS issuance automation details beyond nginx wiring

## 2. Repository Layout Assumption

The service is expected at:

`/opt/snapshot-service`

Typical symlink pattern:

- `/opt/guides` (direct checkout root)
- `/opt/snapshot-service -> /opt/guides/apps/snapshot-service`

If you do not use symlinks, use a direct checkout path and adapt commands accordingly.

## 3. Variables (Playbook Inputs)

Define these once per host:

- `snapshot_env`: `mainnet` or `bepolia`
- `snapshot_user`: `bb`
- `snapshot_group`: `bb`
- `snapshot_root`: `/srv/snapshots`
- `snapshot_public_root`: `/srv/snapshots/public`
- `snapshot_db_path`: `/srv/snapshots/snapshots.db`
- `snapshot_tmp_dir`: `/var/tmp/snapshots`
- `snapshot_chain_installations_dir`: `/srv/chain/installations`
- `snapshot_python_bin`: `/home/bb/ops/.venv/bin/python3`
- `snapshot_service_path`: `/opt/snapshot-service`
- `snapshot_config_path`: `${snapshot_service_path}/config/${snapshot_env}.env`
- `snapshot_scheduler_cron`: `0 8,20 * * *`

## 4. Preconditions

Before deployment, verify:

1. berabox installations required for snapshot types exist and are healthy:
   - `reth-pruned`
   - `reth-archive`
2. user-systemd is available in non-interactive context (`XDG_RUNTIME_DIR`/dbus for cron path).
3. storage mount exists and has sufficient free space:
   - `${snapshot_root}`
4. required tools are installed:
   - `bash`, `sqlite3`, `curl`, `python3`, `lz4`, `tar`, `sha256sum`
5. optional pruning tool exists if using pruned CL:
   - `/home/bb/ops/bin/cosmprund`

## 5. Host Preparation Tasks

### 5.1 Directory state

Ensure directories exist and are owned by `bb:bb`:

- `${snapshot_root}`
- `${snapshot_public_root}`
- `${snapshot_public_root}/snapshots`
- `${snapshot_root}/logs`
- `${snapshot_tmp_dir}`

Idempotent check:

```bash
sudo install -d -o bb -g bb /srv/snapshots /srv/snapshots/public /srv/snapshots/public/snapshots /srv/snapshots/logs /var/tmp/snapshots
```

### 5.2 Python environment

From `snapshot_service_path`:

```bash
cd /opt/snapshot-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If using shared ops venv:

```bash
/home/bb/ops/.venv/bin/pip install -r /opt/snapshot-service/requirements.txt
```

## 6. Configuration Deployment

Copy or template the environment file for selected chain:

- mainnet: `config/mainnet.env`
- bepolia: `config/bepolia.env`

Set `SNAPSHOT_CONFIG_FILE` in cron environment to this file (or rely on default mainnet if that is intended).

Minimum values to verify in env:

- `SNAPSHOT_ENV_NAME`
- `SNAPSHOT_PUBLIC_RPC`
- `SNAPSHOT_PUBLIC_URL_BASE`
- `SNAPSHOT_SITE_TITLE`
- `SNAPSHOT_NAV_TITLE`
- `SNAPSHOT_DOCS_URL`
- `SNAPSHOT_ACTIVE_TYPES` (normally `reth-pruned,reth-archive`)
- `SNAPSHOT_DB_PATH`
- `SNAPSHOT_PUBLIC_ROOT`
- `SNAPSHOT_INSTALLATIONS_DIR`

## 7. Schema Bootstrap (Explicit, Required)

Run:

```bash
bash /opt/snapshot-service/scripts/bootstrap-db.sh /srv/snapshots/snapshots.db
```

This is idempotent and safe to rerun. It creates/updates required tables and indexes.

Validate:

```bash
sqlite3 /srv/snapshots/snapshots.db ".schema snapshots"
sqlite3 /srv/snapshots/snapshots.db ".schema snapshot_runs"
```

## 8. Script Permissions and Sanity

Ensure executable bits:

```bash
chmod +x /opt/snapshot-service/scripts/snapshot-scheduler.sh
chmod +x /opt/snapshot-service/scripts/snapshot-generate.sh
chmod +x /opt/snapshot-service/scripts/snapshot-publish.sh
chmod +x /opt/snapshot-service/scripts/snapshot-prune.sh
chmod +x /opt/snapshot-service/scripts/bootstrap-db.sh
```

Syntax check:

```bash
bash -n /opt/snapshot-service/scripts/snapshot-scheduler.sh
bash -n /opt/snapshot-service/scripts/snapshot-generate.sh
bash -n /opt/snapshot-service/scripts/snapshot-publish.sh
bash -n /opt/snapshot-service/scripts/snapshot-prune.sh
```

## 9. Web Serving (nginx)

Deploy template:

`infra/nginx/snapshots.berachain.com.conf`

Adapt:

- `server_name`
- cert paths
- auth file path for metrics
- root path (should remain `${snapshot_public_root}`)

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 10. Cron Deployment

Recommended: run scheduler directly from vendored path.

Install cron entry for user `bb`:

```cron
0 8,20 * * * SNAPSHOT_CONFIG_FILE=/opt/snapshot-service/config/mainnet.env /opt/snapshot-service/scripts/snapshot-scheduler.sh >> /srv/snapshots/logs/cron.log 2>&1
```

For Bepolia:

```cron
0 8,20 * * * SNAPSHOT_CONFIG_FILE=/opt/snapshot-service/config/bepolia.env /opt/snapshot-service/scripts/snapshot-scheduler.sh >> /srv/snapshots/logs/cron.log 2>&1
```

Install idempotently:

```bash
(crontab -l 2>/dev/null | grep -v "snapshot-scheduler.sh" ; echo '0 8,20 * * * SNAPSHOT_CONFIG_FILE=/opt/snapshot-service/config/mainnet.env /opt/snapshot-service/scripts/snapshot-scheduler.sh >> /srv/snapshots/logs/cron.log 2>&1') | crontab -
```

Verify:

```bash
crontab -l
```

## 11. Functional Validation

### 11.1 Fast validation (no snapshot generation)

1. schema ready:
   - `bash scripts/bootstrap-db.sh /srv/snapshots/snapshots.db`
2. index generation:

```bash
SNAPSHOT_CONFIG_FILE=/opt/snapshot-service/config/mainnet.env /home/bb/ops/.venv/bin/python3 /opt/snapshot-service/scripts/generate-index.py
```

3. confirm outputs:
   - `/srv/snapshots/public/index.html`
   - `/srv/snapshots/public/index.csv`
   - `/srv/snapshots/public/metrics.txt`

### 11.2 Full scheduler dry run approach

If you need a safer first run, clone scheduler and temporarily run one type in a maintenance window by adjusting `SNAPSHOT_ACTIVE_TYPES` in env to a single type.

After run:

- inspect `/srv/snapshots/logs/scheduler-*.log`
- inspect db row counts:

```bash
sqlite3 /srv/snapshots/snapshots.db "select type,count(*) from snapshots where published=1 group by type;"
sqlite3 /srv/snapshots/snapshots.db "select type,status,started_at,ended_at from snapshot_runs order by id desc limit 20;"
```

## 12. Rollback Plan

1. Disable cron line for snapshot scheduler.
2. Restore prior scheduler path if required (only if previously different).
3. Revert nginx config and reload.
4. Keep database and artifacts intact (no destructive rollback needed).

## 13. Operational Notes

- Scheduler now requires schema to be pre-bootstrapped; it will fail fast if missing.
- Geth is treated as deprecated in UI; active generation should remain reth + beacon-kit flow.
- Re-run `bootstrap-db.sh` during upgrades; it is safe and idempotent.
- Keep all environment-specific changes in env files, not script code.

## 14. Example Ansible Task Mapping (Pseudo)

1. `copy`: snapshot-service code to target path (or ensure symlink).
2. `file`: create required directories with ownership.
3. `pip`: install requirements into chosen venv.
4. `template`: install env file (`mainnet.env`/`bepolia.env`).
5. `command`: run `bootstrap-db.sh`.
6. `file`: ensure scripts executable.
7. `template`: deploy nginx conf.
8. `service`: reload nginx.
9. `cron`: install scheduler entry with `SNAPSHOT_CONFIG_FILE`.
10. `command`: run generator smoke test.
11. `command`: assert expected output files exist.

This order is idempotent and safe to rerun.
