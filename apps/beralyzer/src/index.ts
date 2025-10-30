import "dotenv/config";
import { Client } from "pg";
import { loadConfig } from "./config.js";
import { connectPg, getCursor, upsertCursor } from "./db.js";
import { ingestEl } from "./workers/el.js";
import { ingestErc20Registry } from "./workers/erc20.js";
import { ingestClAbsences } from "./workers/cl.js";
import { snapshotTodayIfMissing } from "./workers/day_snapshots.js";
import { runDecoderOnce } from "./workers/decoder.js";
import { resolve } from "path";
import { readFileSync, readdirSync } from "fs";

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

// Graceful shutdown handling
let isShuttingDown = false;
let currentOperation: Promise<any> | null = null;

function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log(`Received ${signal} again, forcing exit`);
      process.exit(1);
    }

    console.log(`Received ${signal}, initiating graceful shutdown...`);
    isShuttingDown = true;

    // Wait for current operation to complete
    if (currentOperation) {
      console.log("Waiting for current operation to complete...");
      try {
        await currentOperation;
        console.log("Current operation completed");
      } catch (e) {
        console.error("Error during shutdown:", (e as Error).message);
      }
    }

    console.log("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  setupGracefulShutdown();

  const cfg = loadConfig();
  console.log(`Beralyzer daemon starting. DB=${cfg.pgDsn}`);
  console.log(
    `Concurrency: ${cfg.concurrency.elFetch} EL threads, ${cfg.concurrency.trace} trace threads, ${cfg.concurrency.blockBatchSize} blocks/batch`,
  );

  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;

  while (!isShuttingDown) {
    const pg = await connectPg(cfg.pgDsn);
    let shouldAdvanceCursor = true;

    // Wrap the main operation in a promise for graceful shutdown
    currentOperation = (async () => {
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
          console.error("Migration error:", (e as Error).message);
          if (isFatalError(e as Error)) {
            console.error("Fatal migration error, stopping daemon");
            process.exit(1);
          }
        }

        // Try each ingestion step, but don't advance cursor if any fail
        try {
          await ingestEl(pg, {
            elRpcUrl: cfg.elRpcUrl,
            blockBatchSize: cfg.concurrency.blockBatchSize,
            txConcurrency: cfg.concurrency.trace,
            log: cfg.log,
            advanceCursor: shouldAdvanceCursor,
          });
        } catch (e) {
          console.error("EL ingestion error:", (e as Error).message);
          if (isFatalError(e as Error)) {
            console.error("Fatal EL error, stopping daemon");
            process.exit(1);
          }
          if (isRetryableError(e as Error)) {
            console.log("EL RPC unavailable, pausing cursor advancement");
            shouldAdvanceCursor = false;
          }
        }

        try {
          await ingestErc20Registry(pg, {
            elRpcUrl: cfg.elRpcUrl,
            batchSize: 500,
          });
        } catch (e) {
          console.error("ERC20 registry error:", (e as Error).message);
          if (isFatalError(e as Error)) {
            console.error("Fatal ERC20 error, stopping daemon");
            process.exit(1);
          }
          if (isRetryableError(e as Error)) {
            console.log(
              "EL RPC unavailable for ERC20, pausing cursor advancement",
            );
            shouldAdvanceCursor = false;
          }
        }

        try {
          await ingestClAbsences(pg, {
            clRpcUrl: cfg.clRpcUrl,
            batchSize: 100,
            validatorRefreshInterval: 500,
            log: cfg.log,
          });
        } catch (e) {
          console.error("CL ingestion error:", (e as Error).message);
          if (isFatalError(e as Error)) {
            console.error("Fatal CL error, stopping daemon");
            process.exit(1);
          }
          if (isRetryableError(e as Error)) {
            console.log("CL RPC unavailable, pausing cursor advancement");
            shouldAdvanceCursor = false;
          }
        }

        try {
          await runDecoderOnce(pg);
        } catch (e) {
          console.error("Decoder error:", (e as Error).message);
          // Decoder errors are usually not fatal, just log and continue
        }

        try {
          await snapshotTodayIfMissing(pg, { clRpcUrl: cfg.clRpcUrl });
        } catch (e) {
          console.error("Snapshot error:", (e as Error).message);
          if (isRetryableError(e as Error)) {
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
        console.error("Unexpected error:", (e as Error).message);
        if (isFatalError(e as Error)) {
          console.error("Fatal error, stopping daemon");
          process.exit(1);
        }
        shouldAdvanceCursor = false;
        consecutiveFailures++;
      } finally {
        await pg.end();
      }
    })();

    // Wait for current operation to complete
    await currentOperation;
    currentOperation = null;

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
