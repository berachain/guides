CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    el_version TEXT,
    cl_version TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_type ON snapshots(type);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_published ON snapshots(published);

CREATE TABLE IF NOT EXISTS snapshot_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    message TEXT,
    local_block INTEGER,
    public_block INTEGER,
    lag INTEGER
);

CREATE INDEX IF NOT EXISTS idx_snapshot_runs_type ON snapshot_runs(type);
CREATE INDEX IF NOT EXISTS idx_snapshot_runs_started ON snapshot_runs(started_at);
