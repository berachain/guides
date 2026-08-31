import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_RECEIPTS_FILENAME = 'staking-pool-receipts.jsonl';

export function resolveReceiptsPath(env = {}, options = {}) {
  if (options.receiptsPath) return options.receiptsPath;
  const fromEnv = env.RECEIPTS_PATH?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), DEFAULT_RECEIPTS_FILENAME);
}

export function recordConfirmedReceipt({
  receiptsPath,
  env = {},
  action,
  hash,
  addresses = {},
  amount = '0',
  requestId,
  requestIds,
  timestamp,
}) {
  if (!hash) {
    throw new Error('Cannot write a receipt without a confirmed transaction hash');
  }
  const path = resolveReceiptsPath(env, { receiptsPath });
  const record = {
    timestamp: timestamp ?? new Date().toISOString(),
    action,
    hash,
    addresses,
    amount: amount == null ? '0' : String(amount),
  };
  if (requestId !== undefined) {
    record.requestId = requestId;
  }
  if (requestIds !== undefined) {
    record.requestIds = requestIds;
  }
  appendReceipt(path, record);
}

export function appendReceipt(path, record) {
  try {
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write receipts file ${path}: ${error.message}`);
  }
}

export function readReceipts(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Torn or incomplete trailing line — prior records stay intact.
    }
  }
  return records;
}
