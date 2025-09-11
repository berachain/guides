export interface BeralyzerConfig {
  pgDsn: string;
  elRpcUrl: string;
  clRpcUrl: string;
  concurrency: {
    elFetch: number;
    trace: number;
  };
  pollMs: number;
  log: boolean;
}

export function loadConfig(): BeralyzerConfig {
  const pgDsn = process.env.PG_DSN || '';
  const elRpcUrl = process.env.EL_ETHRPC_URL || '';
  const clRpcUrl = process.env.CL_ETHRPC_URL || '';
  if (!pgDsn || !elRpcUrl || !clRpcUrl) {
    throw new Error('Missing required env: PG_DSN, EL_ETHRPC_URL, CL_ETHRPC_URL');
  }
  const elFetch = parseInt(process.env.BERALYZER_CONCURRENCY_EL || '12', 10);
  const trace = parseInt(process.env.BERALYZER_CONCURRENCY_TRACE || '8', 10);
  const pollMs = parseInt(process.env.BERALYZER_POLL_MS || '15000', 10);
  const log = /^(1|true|yes)$/i.test(process.env.BERALYZER_LOG || '1');
  return {
    pgDsn,
    elRpcUrl,
    clRpcUrl,
    concurrency: { elFetch: Math.max(1, elFetch), trace: Math.max(1, trace) },
    pollMs: Math.max(0, isNaN(pollMs) ? 15000 : pollMs),
    log
  };
}


