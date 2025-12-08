import { Client } from "pg";

export async function connectPg(dsn: string): Promise<Client> {
  const pg = new Client({ connectionString: dsn });
  await pg.connect();
  return pg;
}

export async function getCursor(
  pg: Client,
  module: string
): Promise<number | null> {
  const { rows } = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    [module]
  );
  if (!rows[0]) return null;
  const v = rows[0].last_processed_height;
  // pg returns int8 as string; coerce to number
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function upsertCursor(
  pg: Client,
  module: string,
  height: number
): Promise<void> {
  await pg.query(
    `INSERT INTO ingest_cursors(module,last_processed_height) VALUES($1,$2)
     ON CONFLICT (module) DO UPDATE SET last_processed_height=EXCLUDED.last_processed_height, updated_at=NOW()`,
    [module, height]
  );
}
