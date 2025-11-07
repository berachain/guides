import { Registry, Counter, Histogram, Gauge } from "prom-client";

export const register = new Registry();

// Register default metrics (CPU, memory, etc.)
register.setDefaultLabels({
  app: "beralyzer",
});

// Block processing metrics
export const blocksProcessed = new Counter({
  name: "beralyzer_blocks_processed_total",
  help: "Total number of blocks processed",
  labelNames: ["type"], // el, cl
  registers: [register],
});

export const blocksProcessDuration = new Histogram({
  name: "beralyzer_blocks_process_duration_seconds",
  help: "Duration of block processing batches in seconds",
  labelNames: ["type"], // el, cl
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const blockProcessingRate = new Gauge({
  name: "beralyzer_blocks_per_second",
  help: "Current blocks processing rate",
  labelNames: ["type"], // el, cl
  registers: [register],
});

// Transaction processing metrics
export const transactionsProcessed = new Counter({
  name: "beralyzer_transactions_processed_total",
  help: "Total number of transactions processed",
  registers: [register],
});

export const transactionProcessingDuration = new Histogram({
  name: "beralyzer_transactions_process_duration_seconds",
  help: "Duration of transaction processing in seconds",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// Cursor/position metrics
export const currentBlockHeight = new Gauge({
  name: "beralyzer_current_block_height",
  help: "Current block height being processed",
  labelNames: ["type"], // el, cl
  registers: [register],
});

export const chainHeadHeight = new Gauge({
  name: "beralyzer_chain_head_height",
  help: "Latest block height on chain",
  labelNames: ["type"], // el, cl
  registers: [register],
});

export const blocksBehind = new Gauge({
  name: "beralyzer_blocks_behind",
  help: "Number of blocks behind chain head",
  labelNames: ["type"], // el, cl
  registers: [register],
});

// RPC call metrics
export const rpcCallsTotal = new Counter({
  name: "beralyzer_rpc_calls_total",
  help: "Total number of RPC calls",
  labelNames: ["endpoint", "method", "status"], // el, cl, success, error
  registers: [register],
});

export const rpcCallDuration = new Histogram({
  name: "beralyzer_rpc_call_duration_seconds",
  help: "Duration of RPC calls in seconds",
  labelNames: ["endpoint", "method"], // el, cl
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const rpcErrors = new Counter({
  name: "beralyzer_rpc_errors_total",
  help: "Total number of RPC errors",
  labelNames: ["endpoint", "error_type"], // el, cl, timeout, connection, etc
  registers: [register],
});

// Loop iteration metrics
export const loopIterations = new Counter({
  name: "beralyzer_loop_iterations_total",
  help: "Total number of main loop iterations",
  registers: [register],
});

export const loopDuration = new Histogram({
  name: "beralyzer_loop_duration_seconds",
  help: "Duration of main loop iterations in seconds",
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

// Database metrics
export const dbQueriesTotal = new Counter({
  name: "beralyzer_db_queries_total",
  help: "Total number of database queries",
  labelNames: ["operation"], // insert, update, select
  registers: [register],
});

export const dbQueryDuration = new Histogram({
  name: "beralyzer_db_query_duration_seconds",
  help: "Duration of database queries in seconds",
  labelNames: ["operation"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// Concurrency metrics
export const activeWorkers = new Gauge({
  name: "beralyzer_active_workers",
  help: "Number of active worker threads",
  labelNames: ["type"], // el_fetch, trace, transactions
  registers: [register],
});

export const queueDepth = new Gauge({
  name: "beralyzer_queue_depth",
  help: "Current queue depth",
  labelNames: ["type"], // blocks, transactions
  registers: [register],
});
