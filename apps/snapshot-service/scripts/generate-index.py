#!/usr/bin/env python3
"""
generate-index.py - Generate HTML index from SQLite snapshot database

Reads snapshot metadata from the database and renders an HTML page
using Jinja2 templates.
"""

import sqlite3
import os
from datetime import datetime, timezone
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
import csv

SCRIPT_DIR = Path(__file__).parent.resolve()
SERVICE_ROOT = SCRIPT_DIR.parent
DEFAULT_CONFIG_PATH = SERVICE_ROOT / "config" / "mainnet.env"
TEMPLATE_DIR = SCRIPT_DIR / "templates"

SNAPSHOT_TYPES = [
    "beacon-kit-pruned",
    "beacon-kit-archive",
    "reth-pruned",
    "reth-archive",
]


def _load_env_file() -> None:
    """Load KEY=VALUE pairs from config env file into process env."""
    config_path = Path(os.getenv("SNAPSHOT_CONFIG_FILE", str(DEFAULT_CONFIG_PATH)))
    if not config_path.exists():
        return

    for line in config_path.read_text().splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_env_file()

DB_PATH = Path(os.getenv("SNAPSHOT_DB_PATH", "/srv/snapshots/snapshots.db"))
PUBLIC_ROOT = Path(os.getenv("SNAPSHOT_PUBLIC_ROOT", "/srv/snapshots/public"))
OUTPUT_PATH = PUBLIC_ROOT / "index.html"
CSV_PATH = PUBLIC_ROOT / "index.csv"
METRICS_PATH = PUBLIC_ROOT / "metrics.txt"
PUBLIC_URL_BASE = os.getenv("SNAPSHOT_PUBLIC_URL_BASE", "https://snapshots.berachain.com").rstrip("/")
SITE_TITLE = os.getenv("SNAPSHOT_SITE_TITLE", "Berachain Snapshots")
NAV_TITLE = os.getenv("SNAPSHOT_NAV_TITLE", "Snapshots")
DOCS_URL = os.getenv("SNAPSHOT_DOCS_URL", "https://docs.berachain.com")
LOGO_URL = os.getenv("SNAPSHOT_LOGO_URL", "/logo-white.svg")
ENV_NAME = os.getenv("SNAPSHOT_ENV_NAME", "mainnet")


def human_size(size_bytes: int) -> str:
    """Convert bytes to human-readable size."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def format_number(value: int) -> str:
    """Format number with thousands separators."""
    return f"{value:,}"


def format_date(value: str) -> str:
    """Format date as 'Jan 14' from ISO timestamp."""
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return dt.strftime("%b %d").replace(" 0", " ")
    except (ValueError, AttributeError):
        return value[:10] if value else ""


def cleanup_missing_snapshots() -> int:
    """Remove database entries for snapshots that no longer exist on disk."""
    if not DB_PATH.exists():
        return 0

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT id, filename, path FROM snapshots WHERE published = 1")
    rows = cursor.fetchall()

    removed = 0
    for row in rows:
        if not Path(row["path"]).exists():
            cursor.execute("DELETE FROM snapshots WHERE id = ?", (row["id"],))
            print(f"Removed missing snapshot from database: {row['filename']}")
            removed += 1

    conn.commit()
    conn.close()
    return removed


def get_snapshots() -> dict:
    """Fetch all published snapshots grouped by type."""
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return {t: [] for t in SNAPSHOT_TYPES}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    snapshots = {t: [] for t in SNAPSHOT_TYPES}

    cursor.execute("""
        SELECT type, filename, path, size_bytes, block_number,
               el_version, cl_version, sha256, created_at
        FROM snapshots
        WHERE published = 1
        ORDER BY type, created_at DESC
    """)

    for row in cursor.fetchall():
        snap = dict(row)
        if not Path(snap["path"]).exists():
            continue
        snap["size_human"] = human_size(snap["size_bytes"])
        if snap["type"] in snapshots:
            snapshots[snap["type"]].append(snap)

    conn.close()
    return snapshots


def get_run_status() -> dict:
    """Fetch latest run status per type."""
    if not DB_PATH.exists():
        return {t: None for t in SNAPSHOT_TYPES}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_runs';")
    if cursor.fetchone() is None:
        conn.close()
        return {t: None for t in SNAPSHOT_TYPES}

    cursor.execute("""
        SELECT type, status, started_at, ended_at, message, local_block, public_block, lag
        FROM snapshot_runs
        WHERE type IN ({})
        ORDER BY started_at DESC
    """.format(",".join("?" for _ in SNAPSHOT_TYPES)), SNAPSHOT_TYPES)

    runs = {t: None for t in SNAPSHOT_TYPES}
    for row in cursor.fetchall():
        if runs[row["type"]] is None:
            runs[row["type"]] = dict(row)

    conn.close()
    return runs


def render_index(snapshots: dict, runs: dict) -> str:
    """Render the index template with snapshot data."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=True
    )
    
    # Add custom filters
    env.filters["format_number"] = format_number
    env.filters["format_date"] = format_date
    
    template = env.get_template("index.html.j2")
    
    return template.render(
        snapshots=snapshots,
        runs=runs,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        site_title=SITE_TITLE,
        nav_title=NAV_TITLE,
        docs_url=DOCS_URL,
        logo_url=LOGO_URL,
        env_name=ENV_NAME,
    )


def write_csv_index(snapshots: dict) -> None:
    """Write machine-readable CSV index of published snapshots (only entries with existing files)."""
    rows = []
    for snapshot_type, items in snapshots.items():
        for s in items:
            if not Path(s["path"]).exists():
                continue
            is_cl = snapshot_type.startswith("beacon-kit")
            row = {
                "type": snapshot_type,
                "size_bytes": s["size_bytes"],
                "block_number": s["block_number"],
                "created_at": s["created_at"],
                "sha256": s["sha256"],
                "url": f"{PUBLIC_URL_BASE}/snapshots/{snapshot_type}/{s['filename']}",
            }
            if is_cl:
                row["version"] = s["cl_version"]
            else:
                row["version"] = s["el_version"] or ""
            rows.append(row)

    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="\n") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "type",
                "size_bytes",
                "block_number",
                "version",
                "created_at",
                "sha256",
                "url",
            ],
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def write_prometheus_metrics(snapshots: dict) -> None:
    """Write Prometheus metrics file with backup timestamps."""
    lines = [
        "# HELP snapshot_backup_last_timestamp_seconds Unix timestamp of the most recent backup",
        "# TYPE snapshot_backup_last_timestamp_seconds gauge",
        "# HELP snapshot_backup_count_total Total number of published backups",
        "# TYPE snapshot_backup_count_total gauge",
    ]

    for snapshot_type in SNAPSHOT_TYPES:
        items = snapshots.get(snapshot_type, [])
        count = len(items)

        # Count metric
        lines.append(f'snapshot_backup_count_total{{type="{snapshot_type}"}} {count}')

        if items:
            # Most recent backup timestamp (items are already sorted by created_at DESC)
            latest = items[0]
            created_at_str = latest["created_at"]

            # Parse timestamp and convert to Unix seconds
            try:
                if created_at_str.endswith('Z'):
                    created_at_str = created_at_str.replace('Z', '+00:00')
                dt = datetime.fromisoformat(created_at_str)
                timestamp_seconds = int(dt.timestamp())
                lines.append(f'snapshot_backup_last_timestamp_seconds{{type="{snapshot_type}"}} {timestamp_seconds}')
            except (ValueError, AttributeError) as e:
                print(f"Warning: Could not parse timestamp for {snapshot_type}: {e}")

    lines.append("")  # Empty line at end

    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.write_text("\n".join(lines))


def main():
    print(f"Generating index from {DB_PATH}")
    
    # Clean up database entries for missing files
    removed = cleanup_missing_snapshots()
    if removed > 0:
        print(f"Cleaned up {removed} missing snapshot(s) from database")
    
    snapshots = get_snapshots()
    runs = get_run_status()
    
    total = sum(len(v) for v in snapshots.values())
    print(f"Found {total} published snapshots")
    
    html = render_index(snapshots, runs)
    
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(html)
    
    print(f"Wrote {OUTPUT_PATH}")

    # Write CSV index (only published snapshots)
    write_csv_index(snapshots)
    print(f"Wrote {CSV_PATH}")

    # Write Prometheus metrics
    write_prometheus_metrics(snapshots)
    print(f"Wrote {METRICS_PATH}")


if __name__ == "__main__":
    main()
