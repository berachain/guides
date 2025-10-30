export interface BeralyzerConfig {
  pgDsn: string;
  elRpcUrls: string[];
  clRpcUrls: string[];
  concurrency: {
    elFetch: number;
    trace: number;
    receipt: number; // Separate concurrency for receipt fetching (2x more than trace)
    blockBatchSize: number;
  };
  pollMs: number;
  log: boolean;
}

export function loadConfig(): BeralyzerConfig {
  const pgDsn = process.env.PG_DSN || "";
  
  // Support semicolon or comma-separated URLs for load balancing
  const elRpcUrl = process.env.EL_ETHRPC_URL || "";
  const elRpcUrls = elRpcUrl
    .split(/[,;]/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  
  const clRpcUrl = process.env.CL_ETHRPC_URL || "";
  const clRpcUrls = clRpcUrl
    .split(/[,;]/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  
  if (!pgDsn || elRpcUrls.length === 0 || clRpcUrls.length === 0) {
    throw new Error(
      "Missing required env: PG_DSN, EL_ETHRPC_URL (comma-separated for load balancing), CL_ETHRPC_URL (comma-separated for load balancing)",
    );
  }
  // Optimize for CPU cores: default to 24 EL fetch threads, 24 trace threads, 512 blocks/batch
  // This leaves headroom for other processes and I/O operations
  const elFetch = parseInt(process.env.BERALYZER_CONCURRENCY_EL || "24", 10);
  const trace = parseInt(process.env.BERALYZER_CONCURRENCY_TRACE || "24", 10);
  // Receipt fetching gets 2x (double) the workers of transaction fetching
  const receipt = parseInt(process.env.BERALYZER_CONCURRENCY_RECEIPT || String(trace * 2), 10);
  const blockBatchSize = parseInt(
    process.env.BERALYZER_BLOCK_BATCH_SIZE || "512",
    10,
  );
  const pollMs = parseInt(process.env.BERALYZER_POLL_MS || "15000", 10);
  const log = /^(1|true|yes)$/i.test(process.env.BERALYZER_LOG || "1");
  return {
    pgDsn,
    elRpcUrls,
    clRpcUrls,
    concurrency: {
      elFetch: Math.max(1, elFetch),
      trace: Math.max(1, trace),
      receipt: Math.max(1, receipt),
      blockBatchSize: Math.max(1, blockBatchSize),
    },
    pollMs: Math.max(0, isNaN(pollMs) ? 15000 : pollMs),
    log,
  };
}
