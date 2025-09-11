import 'dotenv/config';
import { Client } from 'pg';
import { loadConfig } from './config.js';
import { connectPg, getCursor, upsertCursor } from './db.js';
import { ingestEl } from './workers/el.js';
import { ingestErc20Registry } from './workers/erc20.js';
import { ingestClAbsences } from './workers/cl.js';
import { snapshotTodayIfMissing } from './workers/day_snapshots.js';
import { runDecoderOnce } from './workers/decoder.js';
import { resolve } from 'path';
import { readFileSync, readdirSync } from 'fs';

async function main() {
  const cfg = loadConfig();
  console.log(`Beralyzer daemon starting. DB=${cfg.pgDsn}`);
  while (true) {
    const pg = await connectPg(cfg.pgDsn);
    try {
      // Apply migrations at startup of each loop (idempotent)
      try {
        const dir = resolve(process.cwd(), 'sql');
        const files = readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
        await pg.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const applied = new Set<string>((await pg.query('SELECT filename FROM schema_migrations')).rows.map((r: any) => r.filename));
        for (const f of files) {
          if (applied.has(f)) continue;
          const sql = readFileSync(resolve(dir, f), 'utf8');
          await pg.query(sql);
          await pg.query('INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING', [f]);
          if (cfg.log) console.log(`Migration applied: ${f}`);
        }
      } catch (e) {
        console.error('Migration error:', (e as Error).message);
      }

      await ingestEl(pg, {
        elRpcUrl: cfg.elRpcUrl,
        blockBatchSize: 50,
        txConcurrency: 16,
        log: cfg.log
      });
      await ingestErc20Registry(pg, { elRpcUrl: cfg.elRpcUrl, batchSize: 500 });
      await ingestClAbsences(pg, { clRpcUrl: cfg.clRpcUrl, batchSize: 100, validatorRefreshInterval: 500, log: cfg.log });
      await runDecoderOnce(pg);
      await snapshotTodayIfMissing(pg, { clRpcUrl: cfg.clRpcUrl });
    } catch (e) {
      console.error('Tick error:', (e as Error).message);
    } finally {
      await pg.end();
    }
    await new Promise(r => setTimeout(r, cfg.pollMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


