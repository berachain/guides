import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

async function main() {
  const dsn = process.env.PG_DSN || '';
  if (!dsn) {
    console.error('PG_DSN is required');
    process.exit(1);
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dir = resolve(__dirname, '../sql');
  const files = readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const pg = new Client({ connectionString: dsn });
  await pg.connect();
  try {
    // No schema management; DSN governs the database
    await pg.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const appliedSet = new Set<string>((await pg.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename));
    for (const f of files) {
      if (appliedSet.has(f)) continue;
      const sql = readFileSync(resolve(dir, f), 'utf8');
      await pg.query(sql);
      await pg.query('INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING', [f]);
      console.log(`Applied ${f}`);
    }
    console.log('All migrations applied');
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


