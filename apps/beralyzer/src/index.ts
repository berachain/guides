import "dotenv/config";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { connectPg, getCursor, upsertCursor, closePool } from "./db.js";
import { ingestEl } from "./workers/el.js";
import { ingestErc20Registry } from "./workers/erc20.js";
import { ingestClAbsences } from "./workers/cl.js";
import { snapshotTodayIfMissing } from "./workers/day_snapshots.js";
import { runDecoderOnce } from "./workers/decoder.js";
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

// Shutdown handling - just exit, worker threads will be killed
let isShuttingDown = false;
let activeWorkerPromises: Set<Promise<any>> = new Set();

function setupShutdown() {
  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      console.log(`Received ${signal} again, forcing immediate exit`);
      process.exit(1);
    }

    console.log(`Received ${signal}, terminating worker threads and exiting`);
    isShuttingDown = true;

    // Don't wait for anything - just exit
    // Each block is wrapped in its own transaction, so we can safely exit
    // Any in-progress transaction will be rolled back automatically
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

  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;

  // Create connection pool once (reused across all loops)
  const maxConnections = Math.max(
    50,
    cfg.concurrency.elFetch + cfg.concurrency.trace + 10,
  );
  const pg = (await connectPg(cfg.pgDsn, maxConnections)) as Pool;

  while (!isShuttingDown) {
    const loopStart = Date.now();
    loopIterations.inc();

    let shouldAdvanceCursor = true;

    // Main operation loop
    try {
      // Apply migrations at startup of each loop (idempotent)
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
          if (cfg.log) console.log(`Migration applied: ${f}`);
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
      }

      // Try each ingestion step, but don't advance cursor if any fail
      try {
        await ingestEl(pg, {
          elRpcUrls: cfg.elRpcUrls,
          blockBatchSize: cfg.concurrency.blockBatchSize,
          txConcurrency: cfg.concurrency.trace,
          receiptConcurrency: cfg.concurrency.receipt,
          maxQueueDepth: 100, // Pause upstream stages when queue exceeds 100 blocks
          log: cfg.log,
          advanceCursor: shouldAdvanceCursor,
          shouldShutdown: () => isShuttingDown,
        });
      } catch (e) {
        const err = e as Error;
        logDatabaseError("EL ingestion error", err);

        // Check if it's a database error that should be fatal
        const pgError = getPostgresErrorDetails(err);
        if (
          pgError.code &&
          ["23503", "23505", "23514", "23502"].includes(pgError.code)
        ) {
          console.error(
            "Database constraint violation detected, stopping daemon",
          );
          process.exit(1);
        }

        if (isFatalError(err)) {
          console.error("Fatal EL error, stopping daemon");
          process.exit(1);
        }
        if (isRetryableError(err)) {
          console.log("EL RPC unavailable, pausing cursor advancement");
          shouldAdvanceCursor = false;
        }
      }

      try {
        await ingestErc20Registry(pg, {
          elRpcUrls: cfg.elRpcUrls,
          batchSize: 500,
        });
      } catch (e) {
        const err = e as Error;
        logDatabaseError("ERC20 registry error", err);

        const pgError = getPostgresErrorDetails(err);
        if (
          pgError.code &&
          ["23503", "23505", "23514", "23502"].includes(pgError.code)
        ) {
          console.error(
            "Database constraint violation detected in ERC20 registry, stopping daemon",
          );
          process.exit(1);
        }

        if (isFatalError(err)) {
          console.error("Fatal ERC20 error, stopping daemon");
          process.exit(1);
        }
        if (isRetryableError(err)) {
          console.log(
            "EL RPC unavailable for ERC20, pausing cursor advancement",
          );
          shouldAdvanceCursor = false;
        }
      }

      try {
        await ingestClAbsences(pg, {
          clRpcUrls: cfg.clRpcUrls,
          batchSize: 100,
          validatorRefreshInterval: 500,
          log: cfg.log,
        });
      } catch (e) {
        const err = e as Error;
        logDatabaseError("CL ingestion error", err);

        const pgError = getPostgresErrorDetails(err);
        if (
          pgError.code &&
          ["23503", "23505", "23514", "23502"].includes(pgError.code)
        ) {
          console.error(
            "Database constraint violation detected in CL ingestion, stopping daemon",
          );
          process.exit(1);
        }

        if (isFatalError(err)) {
          console.error("Fatal CL error, stopping daemon");
          process.exit(1);
        }
        if (isRetryableError(err)) {
          console.log("CL RPC unavailable, pausing cursor advancement");
          shouldAdvanceCursor = false;
        }
      }

      try {
        await runDecoderOnce(pg);
      } catch (e) {
        const err = e as Error;
        logDatabaseError("Decoder error", err, { non_fatal: true });
        // Decoder errors are usually not fatal, just log and continue
      }

      try {
        await snapshotTodayIfMissing(pg, { clRpcUrls: cfg.clRpcUrls });
      } catch (e) {
        const err = e as Error;
        logDatabaseError("Snapshot error", err);

        const pgError = getPostgresErrorDetails(err);
        if (
          pgError.code &&
          ["23503", "23505", "23514", "23502"].includes(pgError.code)
        ) {
          console.error(
            "Database constraint violation detected in snapshots, stopping daemon",
          );
          process.exit(1);
        }

        if (isRetryableError(err)) {
          console.log(
            "CL RPC unavailable for snapshots, pausing cursor advancement",
          );
          shouldAdvanceCursor = false;
        }
      }

      // Reset failure counter on successful run
      if (shouldAdvanceCursor) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        console.log(
          `Consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`,
        );

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.error(
            `Too many consecutive failures (${consecutiveFailures}), stopping daemon`,
          );
          process.exit(1);
        }
      }
    } catch (e) {
      const err = e as Error;
      logDatabaseError("Unexpected error", err);

      const pgError = getPostgresErrorDetails(err);
      if (
        pgError.code &&
        ["23503", "23505", "23514", "23502"].includes(pgError.code)
      ) {
        console.error(
          "Database constraint violation detected, stopping daemon",
        );
        process.exit(1);
      }

      if (isFatalError(err)) {
        console.error("Fatal error, stopping daemon");
        process.exit(1);
      }
      shouldAdvanceCursor = false;
      consecutiveFailures++;
    } finally {
      // Don't close pool - it's reused across loops
      const loopDurationSeconds = (Date.now() - loopStart) / 1000;
      loopDuration.observe(loopDurationSeconds);
    }

    // Check if we're shutting down
    if (isShuttingDown) {
      console.log("Shutdown requested, exiting main loop");
      break;
    }

    // Only sleep if we're not in a failure state
    if (shouldAdvanceCursor || cfg.pollMs > 0) {
      await new Promise((r) => setTimeout(r, cfg.pollMs));
    } else {
      // Longer sleep when RPC is down to avoid hammering
      console.log("RPC unavailable, sleeping 30s before retry");
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
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
