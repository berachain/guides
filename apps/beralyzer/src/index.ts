import "dotenv/config";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { connectPg, getCursor, upsertCursor, closePool } from "./db.js";
import { ingestEl } from "./workers/el.js";
import { ingestErc20Registry } from "./workers/erc20.js";
import { ingestClAbsences } from "./workers/cl.js";
import { snapshotTodayIfMissing } from "./workers/day_snapshots.js";
import { runDecoderOnce } from "./workers/decoder.js";
import { retryFailedBlocks } from "./workers/retry_failed.js";
import { resolve } from "path";
import { readFileSync, readdirSync } from "fs";
import { createServer } from "http";
import {
  register,
  loopIterations,
  loopDuration,
  currentBlockHeight,
  chainHeadHeight,
  blocksBehind,
} from "./metrics.js";

// Error classification for graceful handling
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("enotfound")
  );
}

function isFatalError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("syntax error") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    message.includes("permission denied") ||
    message.includes("authentication failed") ||
    message.includes("invalid schema")
  );
}

// Extract PostgreSQL error details
function getPostgresErrorDetails(error: any): {
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
  hint?: string;
} {
  if (error.code) {
    return {
      code: error.code,
      constraint: error.constraint,
      table: error.table,
      column: error.column,
      detail: error.detail,
      hint: error.hint,
    };
  }
  return {};
}

// Log database error with full details
function logDatabaseError(
  prefix: string,
  error: Error,
  context?: Record<string, any>,
) {
  const pgError = getPostgresErrorDetails(error);
  const errorDetails: any = {
    message: error.message,
    stack: error.stack,
  };

  if (pgError.code) {
    errorDetails.postgres = {
      code: pgError.code,
      constraint: pgError.constraint,
      table: pgError.table,
      column: pgError.column,
      detail: pgError.detail,
      hint: pgError.hint,
    };

    // Map common error codes to human-readable descriptions
    const errorCodeMap: Record<string, string> = {
      "23503": "Foreign key violation",
      "23505": "Unique constraint violation",
      "23514": "Check constraint violation",
      "23502": "Not null constraint violation",
      "23513": "Check constraint violation",
      "42P01": "Undefined table",
      "42P07": "Duplicate table",
      "42703": "Undefined column",
      "42804": "Datatype mismatch",
      "23000": "Integrity constraint violation",
    };

    errorDetails.error_type =
      errorCodeMap[pgError.code] || `PostgreSQL error ${pgError.code}`;

    if (pgError.code === "23503") {
      errorDetails.referential_integrity = {
        constraint: pgError.constraint,
        table: pgError.table,
        detail: pgError.detail,
      };
    }
  }

  if (context) {
    errorDetails.context = context;
  }

  console.error(`${prefix}:`, JSON.stringify(errorDetails, null, 2));
}

// Shutdown handling - coordinate graceful shutdown across all workers
let isShuttingDown = false;
const activeWorkers: Set<Promise<void>> = new Set();

function setupShutdown() {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log(`Received ${signal} again, forcing immediate exit`);
      process.exit(1);
    }

    console.log(`Received ${signal}, shutting down all workers gracefully...`);
    isShuttingDown = true;

    // Wait for all workers to finish their current iteration (with timeout)
    try {
      await Promise.race([
        Promise.all(Array.from(activeWorkers)),
        new Promise((resolve) => setTimeout(resolve, 30000)), // 30s timeout
      ]);
    } catch (e) {
      console.error("Error during shutdown:", e);
    }

    console.log("All workers stopped, exiting");
    await closePool();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function setupMetricsServer(port: number = 9464) {
  const server = createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": register.contentType });
      res.end(await register.metrics());
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Metrics server listening on http://127.0.0.1:${port}/metrics`);
  });

  return server;
}

// Run migrations once at startup
async function runMigrations(pg: Pool, log: boolean) {
  try {
    const dir = resolve(process.cwd(), "sql");
    const files = readdirSync(dir)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
    await pg.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    );
    const applied = new Set<string>(
      (await pg.query("SELECT filename FROM schema_migrations")).rows.map(
        (r: any) => r.filename,
      ),
    );
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = readFileSync(resolve(dir, f), "utf8");
      await pg.query(sql);
      await pg.query(
        "INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING",
        [f],
      );
      if (log) console.log(`Migration applied: ${f}`);
    }
  } catch (e) {
    const err = e as Error;
    logDatabaseError("Migration error", err);

    const pgError = getPostgresErrorDetails(err);
    if (
      pgError.code &&
      ["23503", "23505", "23514", "23502"].includes(pgError.code)
    ) {
      console.error(
        "Database constraint violation detected in migrations, stopping daemon",
      );
      process.exit(1);
    }

    if (isFatalError(err)) {
      console.error("Fatal migration error, stopping daemon");
      process.exit(1);
    }
    throw err; // Re-throw to prevent startup if migrations fail
  }
}

// EL ingestion worker - runs independently at its own pace
async function runElIngestion(
  pg: Pool,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const workerName = "EL";
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc({ worker: workerName });

    try {
      await ingestEl(pg, {
        elRpcUrls: cfg.elRpcUrls,
        blockBatchSize: cfg.concurrency.blockBatchSize,
        txConcurrency: cfg.concurrency.trace,
        receiptConcurrency: cfg.concurrency.receipt,
        maxQueueDepth: 100,
        log: cfg.log,
        advanceCursor: true,
        shouldShutdown: () => isShuttingDown,
      });

      consecutiveFailures = 0;
    } catch (e) {
      const err = e as Error;
      logDatabaseError(`${workerName} ingestion error`, err);

      const pgError = getPostgresErrorDetails(err);
      if (
        pgError.code &&
        ["23503", "23505", "23514", "23502"].includes(pgError.code)
      ) {
        console.error(
          `Database constraint violation detected in ${workerName}, stopping worker`,
        );
        return; // Exit this worker, others continue
      }

      if (isFatalError(err)) {
        console.error(`Fatal ${workerName} error, stopping worker`);
        return;
      }

      if (isRetryableError(err)) {
        consecutiveFailures++;
        console.log(
          `${workerName} RPC unavailable, consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`,
        );

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(
            `Too many consecutive failures in ${workerName} (${consecutiveFailures}), stopping worker`,
          );
          return;
        }
      }
    } finally {
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe({ worker: workerName }, loopDurationSeconds);
    }

    if (isShuttingDown) break;

    // Sleep before next iteration
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

// ERC20 registry worker - runs independently at its own pace
async function runErc20Registry(
  pg: Pool,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const workerName = "ERC20";
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;
  const pollMs = parseInt(process.env.BERALYZER_ERC20_POLL_MS || "60000", 10); // Default 60s

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc({ worker: workerName });

    try {
      await ingestErc20Registry(pg, {
        elRpcUrls: cfg.elRpcUrls,
        batchSize: 500,
      });

      consecutiveFailures = 0;
    } catch (e) {
      const err = e as Error;
      logDatabaseError(`${workerName} registry error`, err);

      const pgError = getPostgresErrorDetails(err);
      if (
        pgError.code &&
        ["23503", "23505", "23514", "23502"].includes(pgError.code)
      ) {
        console.error(
          `Database constraint violation detected in ${workerName}, stopping worker`,
        );
        return;
      }

      if (isFatalError(err)) {
        console.error(`Fatal ${workerName} error, stopping worker`);
        return;
      }

      if (isRetryableError(err)) {
        consecutiveFailures++;
        console.log(
          `${workerName} RPC unavailable, consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`,
        );

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(
            `Too many consecutive failures in ${workerName} (${consecutiveFailures}), stopping worker`,
          );
          return;
        }
      }
    } finally {
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe({ worker: workerName }, loopDurationSeconds);
    }

    if (isShuttingDown) break;

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// CL ingestion worker - runs independently at its own pace
async function runClIngestion(
  pg: Pool,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const workerName = "CL";
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;
  const pollMs = parseInt(process.env.BERALYZER_CL_POLL_MS || "30000", 10); // Default 30s

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc({ worker: workerName });

    try {
      await ingestClAbsences(pg, {
        clRpcUrls: cfg.clRpcUrls,
        batchSize: 100,
        validatorRefreshInterval: 500,
        log: cfg.log,
      });

      consecutiveFailures = 0;
    } catch (e) {
      const err = e as Error;
      logDatabaseError(`${workerName} ingestion error`, err);

      const pgError = getPostgresErrorDetails(err);
      if (
        pgError.code &&
        ["23503", "23505", "23514", "23502"].includes(pgError.code)
      ) {
        console.error(
          `Database constraint violation detected in ${workerName}, stopping worker`,
        );
        return;
      }

      if (isFatalError(err)) {
        console.error(`Fatal ${workerName} error, stopping worker`);
        return;
      }

      if (isRetryableError(err)) {
        consecutiveFailures++;
        console.log(
          `${workerName} RPC unavailable, consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`,
        );

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(
            `Too many consecutive failures in ${workerName} (${consecutiveFailures}), stopping worker`,
          );
          return;
        }
      }
    } finally {
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe({ worker: workerName }, loopDurationSeconds);
    }

    if (isShuttingDown) break;

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// Decoder worker - runs independently at its own pace
async function runDecoder(
  pg: Pool,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const workerName = "Decoder";
  const pollMs = parseInt(process.env.BERALYZER_DECODER_POLL_MS || "60000", 10); // Default 60s

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc({ worker: workerName });

    try {
      await runDecoderOnce(pg);
    } catch (e) {
      const err = e as Error;
      logDatabaseError(`${workerName} error`, err, { non_fatal: true });
      // Decoder errors are usually not fatal, just log and continue
    } finally {
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe({ worker: workerName }, loopDurationSeconds);
    }

    if (isShuttingDown) break;

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// Snapshot worker - runs independently at its own pace
async function runSnapshots(
  pg: Pool,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const workerName = "Snapshots";
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;
  const pollMs = parseInt(
    process.env.BERALYZER_SNAPSHOT_POLL_MS || "300000",
    10,
  ); // Default 5 minutes

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc({ worker: workerName });

    try {
      await snapshotTodayIfMissing(pg, { clRpcUrls: cfg.clRpcUrls });

      consecutiveFailures = 0;
    } catch (e) {
      const err = e as Error;
      logDatabaseError(`${workerName} error`, err);

      const pgError = getPostgresErrorDetails(err);
      if (
        pgError.code &&
        ["23503", "23505", "23514", "23502"].includes(pgError.code)
      ) {
        console.error(
          `Database constraint violation detected in ${workerName}, stopping worker`,
        );
        return;
      }

      if (isRetryableError(err)) {
        consecutiveFailures++;
        console.log(
          `${workerName} RPC unavailable, consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`,
        );

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(
            `Too many consecutive failures in ${workerName} (${consecutiveFailures}), stopping worker`,
          );
          return;
        }
      }
    } finally {
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe({ worker: workerName }, loopDurationSeconds);
    }

    if (isShuttingDown) break;

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// Failed blocks retry worker - processes failed blocks independently without affecting cursor
async function runFailedBlocksRetry(
  pg: Pool,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const workerName = "FailedBlocksRetry";
  const pollMs = parseInt(process.env.BERALYZER_RETRY_POLL_MS || "60000", 10); // Default 60s

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc({ worker: workerName });

    try {
      await retryFailedBlocks(pg, {
        elRpcUrls: cfg.elRpcUrls,
        log: cfg.log,
        shouldShutdown: () => isShuttingDown,
      });
    } catch (e) {
      const err = e as Error;
      logDatabaseError(`${workerName} error`, err, { non_fatal: true });
      // Retry errors are not fatal, just log and continue
    } finally {
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe({ worker: workerName }, loopDurationSeconds);
    }

    if (isShuttingDown) break;

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function main() {
  setupShutdown();

  const cfg = loadConfig();
  const metricsPort = parseInt(
    process.env.BERALYZER_METRICS_PORT || "9464",
    10,
  );
  setupMetricsServer(metricsPort);

  console.log(`Beralyzer daemon starting. DB=${cfg.pgDsn}`);
  console.log(
    `Concurrency: ${cfg.concurrency.elFetch} EL threads, ${cfg.concurrency.trace} transaction threads, ${cfg.concurrency.receipt} receipt threads`,
  );
  console.log(`Metrics: http://127.0.0.1:${metricsPort}/metrics`);
  console.log(
    "Architecture: All indexing processes run independently in parallel",
  );

  // Create connection pool sized for concurrent workers
  // Each worker may need connections, so we size for all concurrent operations
  const maxConnections = Math.max(
    100, // Minimum pool size for concurrent workers
    cfg.concurrency.elFetch +
      cfg.concurrency.trace +
      cfg.concurrency.receipt +
      20, // Headroom for other workers
  );
  const pg = (await connectPg(cfg.pgDsn, maxConnections)) as Pool;

  // Run migrations once at startup
  await runMigrations(pg, cfg.log);

  // Launch all indexing workers in parallel - each runs at its own speed
  const elWorker = runElIngestion(pg, cfg);
  const erc20Worker = runErc20Registry(pg, cfg);
  const clWorker = runClIngestion(pg, cfg);
  const decoderWorker = runDecoder(pg, cfg);
  const snapshotWorker = runSnapshots(pg, cfg);
  const retryWorker = runFailedBlocksRetry(pg, cfg);

  // Track all workers for shutdown coordination
  activeWorkers.add(elWorker);
  activeWorkers.add(erc20Worker);
  activeWorkers.add(clWorker);
  activeWorkers.add(decoderWorker);
  activeWorkers.add(snapshotWorker);
  activeWorkers.add(retryWorker);

  // Wait for all workers (they run until shutdown)
  await Promise.all([
    elWorker.catch((err) => {
      console.error("EL worker exited with error:", err);
    }),
    erc20Worker.catch((err) => {
      console.error("ERC20 worker exited with error:", err);
    }),
    clWorker.catch((err) => {
      console.error("CL worker exited with error:", err);
    }),
    decoderWorker.catch((err) => {
      console.error("Decoder worker exited with error:", err);
    }),
    snapshotWorker.catch((err) => {
      console.error("Snapshot worker exited with error:", err);
    }),
    retryWorker.catch((err) => {
      console.error("Failed blocks retry worker exited with error:", err);
    }),
  ]);
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});

// Cleanup pool on exit
process.on("SIGINT", async () => {
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closePool();
  process.exit(0);
});
