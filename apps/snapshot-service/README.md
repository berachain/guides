# Snapshot Service (Production Chain)

This package vendors the production snapshot pipeline that currently runs from cron on the snapshot host. The goal is to keep the exact runtime code path in git so cloning the service to another machine is deterministic instead of depending on ad hoc files on a server.

The runtime chain is:

`cron -> snapshot-scheduler.sh -> snapshot-generate.sh -> snapshot-publish.sh -> snapshot-prune.sh -> generate-index.py`

`snapshot-scheduler.sh` is the only cron entrypoint. It coordinates lock handling, disk-space checks, run tracking in SQLite, and index regeneration. `snapshot-generate.sh` performs health/sync checks, stops and starts services through berabox, optionally runs `cosmprund` for pruned CL snapshots, and emits `.tar.lz4` artifacts. `snapshot-publish.sh` moves generated artifacts into the public tree and inserts metadata rows. `snapshot-prune.sh` deletes oldest snapshots while preserving at least one snapshot per type. `generate-index.py` renders the HTML page and writes `index.csv` and `metrics.txt`.

## Included Artifacts

The package includes production scripts under `scripts/`, Jinja templates under `scripts/templates/`, database schema under `sql/`, and deployment templates under `infra/` for cron and nginx.

Runtime behavior is configured via env files in `config/`:

- `config/mainnet.env`
- `config/bepolia.env`

By default scripts load `config/mainnet.env`. Set `SNAPSHOT_CONFIG_FILE` to target another chain/environment.

## Python Environment

`generate-index.py` requires Jinja2. A dependency manifest is included at `requirements.txt`.

Recommended setup:

```bash
cd apps/snapshot-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuration

Use one of the provided config files and export it before manual runs:

```bash
export SNAPSHOT_CONFIG_FILE=/opt/snapshot-service/config/mainnet.env
# or
export SNAPSHOT_CONFIG_FILE=/opt/snapshot-service/config/bepolia.env
```

## Database Bootstrap

Initialize or migrate the SQLite database with:

```bash
bash scripts/bootstrap-db.sh
```

This applies `sql/schema.sql` and ensures `snapshots` and `snapshot_runs` plus indexes are present.
The scheduler no longer embeds schema DDL; it fails fast if the schema is missing.

## Deployment Notes

Use `infra/cron/snapshot-scheduler.cron` for the scheduler crontab line and `infra/nginx/snapshots.berachain.com.conf` as the public serving template. These are checked in as templates so infra can be reviewed and reproduced in code review.

Recommended production entrypoint:

`/opt/snapshot-service/scripts/snapshot-scheduler.sh`
