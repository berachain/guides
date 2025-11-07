import { Pool, Client } from "pg";
import { ethers } from "ethers";
import { classifyClient, decodeExtraDataAscii } from "../decoders.js";
import { RoundRobinProvider } from "../rpc-balancer.js";
import {
  blocksProcessed,
  blocksProcessDuration,
  blockProcessingRate,
  transactionsProcessed,
  transactionProcessingDuration,
  currentBlockHeight,
  chainHeadHeight,
  blocksBehind,
  rpcCallsTotal,
  rpcCallDuration,
  rpcErrors,
  dbQueriesTotal,
  dbQueryDuration,
  activeWorkers,
  queueDepth,
} from "../metrics.js";

// Transaction type classification
function classifyTransactionType(tx: any): string {
  const type = tx.type;
  if (type === 0) return "legacy";
  if (type === 1) return "access_list";
  if (type === 2) return "eip1559";
  if (type === 3) return "blob";
  if (type === 4) return "eip7702";
  return "unknown";
}

// Parse EIP-7702 transaction data
function parseEIP7702Transaction(tx: any) {
  if (tx.type !== 4) return null;

  const contractCode = tx.contract_code || null;
  const codeHash = contractCode ? ethers.keccak256(contractCode) : null;

  return {
    authorization: tx.authorization || null,
    contractCodeHash: codeHash,
    delegationAddress: tx.delegation_address || null,
  };
}

// Parse blob transaction data
function parseBlobTransaction(tx: any) {
  if (tx.type !== 3) return null;

  return {
    blobVersionedHashes: tx.blob_versioned_hashes || null,
    maxFeePerBlobGas: tx.max_fee_per_blob_gas
      ? BigInt(tx.max_fee_per_blob_gas).toString()
      : null,
    blobGasUsed: tx.blob_gas_used ? BigInt(tx.blob_gas_used).toString() : null,
  };
}

// Parse access list transaction data
function parseAccessListTransaction(tx: any) {
  if (tx.type !== 1) return null;

  return {
    accessList: tx.access_list || null,
  };
}

export interface ElWorkerConfig {
  elRpcUrls: string[]; // Multiple EL RPC URLs for load balancing
  blockBatchSize: number; // how many blocks per batch (deprecated - processing is now per-block)
  txConcurrency: number; // parallelism for transaction fetches
  receiptConcurrency: number; // parallelism for receipt fetches (typically 2x more than tx)
  maxQueueDepth?: number; // Maximum queue depth before pausing upstream stages (default 100)
  advanceCursor?: boolean; // whether to advance the cursor (default true)
  shouldShutdown?: () => boolean; // function to check if should shutdown
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function ingestEl(
  pg: Pool | Client,
  cfg: ElWorkerConfig & { log?: boolean },
): Promise<void> {
  const provider = new RoundRobinProvider(cfg.elRpcUrls);
  if (cfg.log) {
    console.log(
      `EL: Using ${cfg.elRpcUrls.length} RPC endpoint(s): ${cfg.elRpcUrls.join(", ")}`,
    );
  }

  // Load cursor
  const curRes = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    ["blocks_el"],
  );

  const rpcStart = Date.now();
  let latest: number;
  try {
    latest = await provider.getBlockNumber();
    rpcCallsTotal.inc({
      endpoint: "el",
      method: "getBlockNumber",
      status: "success",
    });
    rpcCallDuration.observe(
      { endpoint: "el", method: "getBlockNumber" },
      (Date.now() - rpcStart) / 1000,
    );
  } catch (e) {
    rpcCallsTotal.inc({
      endpoint: "el",
      method: "getBlockNumber",
      status: "error",
    });
    rpcErrors.inc({
      endpoint: "el",
      error_type: (e as Error).constructor.name,
    });
    throw e;
  }

  chainHeadHeight.set({ type: "el" }, latest);

  const start = (() => {
    if (curRes.rows[0]) {
      const v = curRes.rows[0].last_processed_height;
      const n = typeof v === "number" ? v : Number(v);
      return Math.max(0, Number.isFinite(n) ? n : 0) + 1;
    }
    return 1;
  })();
  const end = latest;

  currentBlockHeight.set({ type: "el" }, start - 1);
  blocksBehind.set({ type: "el" }, end - start + 1);

  if (start > end) return; // nothing to do

  let nextCursor = start - 1;
  let totalTransactions = 0;

  const t0All = Date.now();

  // Multi-stage pipeline architecture: 4 stages working on different blocks in parallel
  // Stage 1: Header Fetcher → Stage 2: TX Fetcher → Stage 3: Receipt Fetcher → Stage 4: DB Writer
  // This ensures workers are always busy across different blocks

  interface HeaderBlock {
    bn: number;
    blk: any;
    txHashes: string[];
  }

  interface TxBlock {
    bn: number;
    blk: any;
    txHashes: string[];
    txMap: Map<string, any>;
  }

  interface ReadyBlock {
    bn: number;
    blk: any;
    allItems: Array<{ tx: any; receipt: any } | null>;
  }

  const headerQueue: HeaderBlock[] = [];
  const txQueue: TxBlock[] = [];
  const receiptQueue: TxBlock[] = [];
  const readyQueue: ReadyBlock[] = [];

  let headerIndex = start;
  let txIndex = start;
  let receiptIndex = start;
  let writeIndex = start;

  const maxQueueSize = 10; // Keep multiple blocks in each stage
  const maxQueueDepth = cfg.maxQueueDepth || 100; // Pause upstream stages if queue exceeds this
  const maxBlocksAhead = 20; // Maximum blocks any stage can be ahead of write stage

  // Stage 1: Header Fetcher - continuously fetches block headers
  const headerFetcherLoop = async () => {
    while (
      headerIndex <= end &&
      (!cfg.shouldShutdown || !cfg.shouldShutdown())
    ) {
      // Backpressure: pause if headerQueue is too large
      while (headerQueue.length >= maxQueueSize) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const bn = headerIndex++;
      const rpcStart = Date.now();
      let blk: any;
      try {
        blk = await provider.getBlock(bn);
        rpcCallsTotal.inc({
          endpoint: "el",
          method: "getBlock",
          status: "success",
        });
        rpcCallDuration.observe(
          { endpoint: "el", method: "getBlock" },
          (Date.now() - rpcStart) / 1000,
        );
        const txHashes: string[] = blk.transactions as any;
        headerQueue.push({ bn, blk, txHashes });
      } catch (e) {
        rpcCallsTotal.inc({
          endpoint: "el",
          method: "getBlock",
          status: "error",
        });
        rpcErrors.inc({
          endpoint: "el",
          error_type: (e as Error).constructor.name,
        });
        headerQueue.push({ bn, blk: null as any, txHashes: [] }); // Push null to maintain order
      }
    }
  };

  // Stage 2: TX Fetcher - continuously fetches transactions
  const txFetcherLoop = async () => {
    while (txIndex <= end || headerQueue.length > 0) {
      if (cfg.shouldShutdown && cfg.shouldShutdown()) break;

      // Backpressure: pause TX fetching if tx_queue is too large (receipt fetcher can't keep up)
      while (txQueue.length >= maxQueueDepth) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // Longer pause when throttled
      }

      while (headerQueue.length === 0 && headerIndex <= end) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (headerQueue.length === 0 && headerIndex > end) {
        if (txQueue.length === 0) break;
      }

      const header = headerQueue.shift();
      if (!header) continue;

      if (!header.blk) {
        txQueue.push({
          bn: header.bn,
          blk: null as any,
          txHashes: [],
          txMap: new Map(),
        });
        txIndex++;
        continue;
      }

      const { bn, blk, txHashes } = header;
      const t0 = Date.now();
      const txMap = new Map<string, any>();

      // Fetch all transactions in parallel (chunked)
      for (let i = 0; i < txHashes.length; i += cfg.txConcurrency) {
        const chunk = txHashes.slice(i, i + cfg.txConcurrency);
        activeWorkers.set({ type: "trace" }, chunk.length);

        await Promise.all(
          chunk.map(async (h) => {
            const rpcStart = Date.now();
            try {
              const tx = await provider.getTransaction(h);
              rpcCallsTotal.inc({
                endpoint: "el",
                method: "getTransaction",
                status: "success",
              });
              rpcCallDuration.observe(
                { endpoint: "el", method: "getTransaction" },
                (Date.now() - rpcStart) / 1000,
              );
              txMap.set(h.toLowerCase(), tx);
            } catch (e) {
              rpcCallsTotal.inc({
                endpoint: "el",
                method: "getTransaction",
                status: "error",
              });
              rpcErrors.inc({
                endpoint: "el",
                error_type: (e as Error).constructor.name,
              });
            }
          }),
        );
      }

      activeWorkers.set({ type: "trace" }, 0);
      txQueue.push({ bn, blk, txHashes, txMap });
      txIndex++;
      queueDepth.set({ type: "tx_queue" }, txQueue.length);

      if (cfg.log && bn % 100 === 0) {
        console.log(
          `EL: block ${bn} fetched transactions in ${Date.now() - t0}ms (${txHashes.length} txs), tx queue size: ${txQueue.length}`,
        );
      }
    }
  };

  // Stage 3: Receipt Fetcher - continuously fetches receipts
  const receiptFetcherLoop = async () => {
    while (receiptIndex <= end || txQueue.length > 0) {
      if (cfg.shouldShutdown && cfg.shouldShutdown()) break;

      while (txQueue.length === 0 && txIndex <= end) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (txQueue.length === 0 && txIndex > end) {
        if (receiptQueue.length === 0) break;
      }

      const txBlock = txQueue.shift();
      if (!txBlock) continue;

      if (!txBlock.blk) {
        readyQueue.push({ bn: txBlock.bn, blk: null as any, allItems: [] }); // Pass through null blocks
        receiptIndex++;
        continue;
      }

      const { bn, blk, txHashes, txMap } = txBlock;
      const t0 = Date.now();
      const receiptMap = new Map<string, any>();

      // Fetch all receipts in parallel (chunked) - use higher concurrency for receipts
      for (let i = 0; i < txHashes.length; i += cfg.receiptConcurrency) {
        const chunk = txHashes.slice(i, i + cfg.receiptConcurrency);
        activeWorkers.set({ type: "receipt" }, chunk.length);

        await Promise.all(
          chunk.map(async (h) => {
            const rpcStart = Date.now();
            try {
              const receipt = await provider.getTransactionReceipt(h);
              rpcCallsTotal.inc({
                endpoint: "el",
                method: "getTransactionReceipt",
                status: "success",
              });
              rpcCallDuration.observe(
                { endpoint: "el", method: "getTransactionReceipt" },
                (Date.now() - rpcStart) / 1000,
              );
              receiptMap.set(h.toLowerCase(), receipt);
            } catch (e) {
              rpcCallsTotal.inc({
                endpoint: "el",
                method: "getTransactionReceipt",
                status: "error",
              });
              rpcErrors.inc({
                endpoint: "el",
                error_type: (e as Error).constructor.name,
              });
            }
          }),
        );
      }

      activeWorkers.set({ type: "receipt" }, 0);

      // Match transactions and receipts
      const allItems: Array<{ tx: any; receipt: any } | null> = txHashes.map(
        (h) => {
          const hashLower = h.toLowerCase();
          const tx = txMap.get(hashLower);
          const receipt = receiptMap.get(hashLower);
          if (tx && receipt) {
            return { tx, receipt };
          }
          return null;
        },
      );

      readyQueue.push({ bn, blk, allItems });
      receiptIndex++;
      queueDepth.set({ type: "ready_queue" }, readyQueue.length);

      if (cfg.log && bn % 100 === 0) {
        console.log(
          `EL: block ${bn} fetched receipts in ${Date.now() - t0}ms (${txHashes.length} txs), ready queue size: ${readyQueue.length}`,
        );
      }

      transactionProcessingDuration.observe(0); // Track per-block in write loop instead
    }
  };

  // Stage 4: DB Writer - processes ready blocks sequentially
  const writeLoop = async () => {
    while (writeIndex <= end || readyQueue.length > 0) {
      if (cfg.shouldShutdown && cfg.shouldShutdown()) break;

      // Wait for next block to be ready
      while (readyQueue.length === 0 && receiptIndex <= end) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Check if we're done
      if (readyQueue.length === 0 && receiptIndex > end) {
        break;
      }

      // Get next block from queue (maintains order)
      const ready = readyQueue.shift();
      if (!ready) continue;

      const { bn, blk, allItems } = ready;

      // Skip if block fetch failed
      if (!blk) {
        writeIndex++;
        continue;
      }

      const t0 = Date.now();

      // Start transaction for this block
      const isPool = "query" in pg;
      let transactionClient: any = null;

      try {
        if (isPool) {
          transactionClient = await (pg as Pool).connect();
          await transactionClient.query("BEGIN");
        } else {
          transactionClient = pg as Client;
          await transactionClient.query("BEGIN");
        }

        try {
          // Insert block header
          const baseFee = blk.baseFeePerGas ? BigInt(blk.baseFeePerGas) : null;
          const extra = (blk as any).extraData as string | undefined;
          const decoded = decodeExtraDataAscii(extra);
          const chainClientInfo = classifyClient(decoded);
          const gasLimit = (blk as any).gasLimit
            ? BigInt((blk as any).gasLimit)
            : null;

          const queryStart = Date.now();
          await transactionClient.query(
            `INSERT INTO blocks(height, el_hash, timestamp, proposer_address, base_fee_per_gas_wei, gas_used_total, gas_limit, tx_count, chain_client, chain_client_type, chain_client_version)
             VALUES($1,$2,to_timestamp($3), NULL, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (height) DO NOTHING`,
            [
              bn,
              blk.hash,
              Number(blk.timestamp),
              baseFee ? baseFee.toString() : null,
              blk.gasUsed ? BigInt(blk.gasUsed).toString() : null,
              gasLimit ? gasLimit.toString() : null,
              blk.transactions.length,
              chainClientInfo.full,
              chainClientInfo.type,
              chainClientInfo.version,
            ],
          );
          dbQueriesTotal.inc({ operation: "insert" });
          dbQueryDuration.observe(
            { operation: "insert" },
            (Date.now() - queryStart) / 1000,
          );

          let sumEffPrice = 0n;
          let sumPriorityPerGas = 0n;
          let txWithPrices = 0;
          let totalFees = 0n;
          let totalPriorityFees = 0n;

          // Process ALL transactions in parallel (no chunking for DB inserts!)
          activeWorkers.set({ type: "transactions" }, allItems.length);
          queueDepth.set({ type: "transactions" }, 0);

          const baseFeeWei = blk.baseFeePerGas ? BigInt(blk.baseFeePerGas) : 0n;
          const processResults = await Promise.all(
            allItems.map(async (item) => {
              if (!item) return null;
              const { tx, receipt } = item;
              if (!tx || !receipt) return null;

              transactionsProcessed.inc();

              const selector =
                tx.data && tx.data.length >= 10
                  ? ("0x" + tx.data.slice(2, 10)).toLowerCase()
                  : null;
              const inputSize = tx.data ? (tx.data.length - 2) / 2 : 0;
              const createsContract = !tx.to;
              const createdAddress = (receipt as any)?.contractAddress || null;

              // Derive ERC20 transfer counts
              let transferCount = 0;
              const tokenSet = new Set<string>();
              if (receipt && Array.isArray(receipt.logs)) {
                for (const log of receipt.logs) {
                  if (
                    (log.topics?.[0] || "").toLowerCase() === TRANSFER_TOPIC
                  ) {
                    transferCount++;
                    if (log.address) tokenSet.add(log.address.toLowerCase());
                  }
                }
              }

              // Derive fee metrics if available
              const effPriceHex = (receipt as any).effectiveGasPrice as
                | string
                | undefined;
              const gasUsedHex = (receipt as any).gasUsed as string | undefined;
              const effPrice = effPriceHex ? BigInt(effPriceHex) : 0n;
              const gasUsed = gasUsedHex ? BigInt(gasUsedHex) : 0n;
              const prioPerGas =
                effPrice > baseFeeWei ? effPrice - baseFeeWei : 0n;
              const totalFee = gasUsed * effPrice;
              const totalPrioFee = gasUsed * prioPerGas;

              const statusHex = (receipt as any).status as string | undefined;
              const statusBool = statusHex
                ? parseInt(statusHex, 16) === 1
                : null;
              const gasUsedHexR = (receipt as any).gasUsed as
                | string
                | undefined;
              const cumGasHex = (receipt as any).cumulativeGasUsed as
                | string
                | undefined;
              const effPriceHexR = (receipt as any).effectiveGasPrice as
                | string
                | undefined;

              // Parse transaction type specific data
              const transactionCategory = classifyTransactionType(tx);
              const eip7702Data = parseEIP7702Transaction(tx);
              const blobData = parseBlobTransaction(tx);
              const accessListData = parseAccessListTransaction(tx);

              // Parallel database insert - use transactionClient to keep in same transaction
              // PostgreSQL Client queues concurrent queries on same connection, still faster than sequential
              const queryStart = Date.now();
              await transactionClient.query(
                `INSERT INTO transactions(hash, block_height, from_address, to_address, value_wei, gas_limit, max_fee_per_gas_wei, max_priority_fee_per_gas_wei, type, selector, input_size, creates_contract, created_contract_address, state_change_accounts, erc20_transfer_count, erc20_unique_token_count, status, gas_used, cumulative_gas_used, effective_gas_price_wei, total_fee_wei, priority_fee_per_gas_wei, transaction_category, access_list, blob_versioned_hashes, max_fee_per_blob_gas_wei, blob_gas_used, eip_7702_authorization, eip_7702_contract_code_hash, eip_7702_delegation_address)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
               ON CONFLICT (hash) DO UPDATE SET
                 selector=EXCLUDED.selector,
                 input_size=EXCLUDED.input_size,
                 creates_contract=EXCLUDED.creates_contract,
                 created_contract_address=EXCLUDED.created_contract_address,
                 erc20_transfer_count=EXCLUDED.erc20_transfer_count,
                 erc20_unique_token_count=EXCLUDED.erc20_unique_token_count,
                 status=EXCLUDED.status,
                 gas_used=EXCLUDED.gas_used,
                 cumulative_gas_used=EXCLUDED.cumulative_gas_used,
                 effective_gas_price_wei=EXCLUDED.effective_gas_price_wei,
                 total_fee_wei=EXCLUDED.total_fee_wei,
                 priority_fee_per_gas_wei=EXCLUDED.priority_fee_per_gas_wei,
                 transaction_category=EXCLUDED.transaction_category,
                 access_list=EXCLUDED.access_list,
                 blob_versioned_hashes=EXCLUDED.blob_versioned_hashes,
                 max_fee_per_blob_gas_wei=EXCLUDED.max_fee_per_blob_gas_wei,
                 blob_gas_used=EXCLUDED.blob_gas_used,
                 eip_7702_authorization=EXCLUDED.eip_7702_authorization,
                 eip_7702_contract_code_hash=EXCLUDED.eip_7702_contract_code_hash,
                 eip_7702_delegation_address=EXCLUDED.eip_7702_delegation_address`,
                [
                  tx.hash,
                  bn,
                  tx.from?.toLowerCase() ?? null,
                  tx.to?.toLowerCase() ?? null,
                  tx.value ? BigInt(tx.value).toString() : "0",
                  (tx as any).gasLimit
                    ? BigInt((tx as any).gasLimit).toString()
                    : null,
                  (tx as any).maxFeePerGas
                    ? BigInt((tx as any).maxFeePerGas).toString()
                    : null,
                  (tx as any).maxPriorityFeePerGas
                    ? BigInt((tx as any).maxPriorityFeePerGas).toString()
                    : null,
                  tx.type !== undefined
                    ? typeof tx.type === "string"
                      ? parseInt(tx.type, 16)
                      : Number(tx.type)
                    : null,
                  selector,
                  inputSize,
                  createsContract,
                  createdAddress?.toLowerCase() ?? null,
                  0,
                  transferCount,
                  tokenSet.size,
                  statusBool,
                  gasUsedHexR ? BigInt(gasUsedHexR).toString() : null,
                  cumGasHex ? BigInt(cumGasHex).toString() : null,
                  effPriceHexR ? BigInt(effPriceHexR).toString() : null,
                  effPriceHexR && gasUsedHexR ? totalFee.toString() : null,
                  effPriceHexR ? prioPerGas.toString() : null,
                  transactionCategory,
                  accessListData?.accessList || null,
                  blobData?.blobVersionedHashes || null,
                  blobData?.maxFeePerBlobGas || null,
                  blobData?.blobGasUsed || null,
                  eip7702Data?.authorization || null,
                  eip7702Data?.contractCodeHash || null,
                  eip7702Data?.delegationAddress || null,
                ],
              );
              dbQueriesTotal.inc({ operation: "insert" });
              dbQueryDuration.observe(
                { operation: "insert" },
                (Date.now() - queryStart) / 1000,
              );

              // Handle contract creation if needed (same transaction)
              if (createsContract && createdAddress) {
                const contractQueryStart = Date.now();
                await transactionClient.query(
                  `INSERT INTO contracts(address, created_by_tx, created_at_block, bytecode_hash, is_proxy, implementation_address)
                 VALUES($1,$2,$3,NULL,NULL,NULL)
                 ON CONFLICT (address) DO NOTHING`,
                  [createdAddress.toLowerCase(), tx.hash, bn],
                );
                dbQueriesTotal.inc({ operation: "insert" });
                dbQueryDuration.observe(
                  { operation: "insert" },
                  (Date.now() - contractQueryStart) / 1000,
                );
              }

              // Return aggregate data for block-level calculations
              return {
                hasPrice: effPriceHex && gasUsedHex,
                effPrice,
                prioPerGas,
                totalFee,
                totalPrioFee,
              };
            }),
          );

          // Calculate block aggregates from parallel results
          for (const result of processResults) {
            if (!result) continue;
            if (result.hasPrice) {
              sumEffPrice += result.effPrice;
              sumPriorityPerGas += result.prioPerGas;
              totalFees += result.totalFee;
              totalPriorityFees += result.totalPrioFee;
              txWithPrices++;
            }
          }

          // All transactions processed
          activeWorkers.set({ type: "transactions" }, 0);

          // After processing txs for this block, update block aggregates if we had prices
          if (txWithPrices > 0) {
            const avgEff = sumEffPrice / BigInt(txWithPrices);
            const avgPrio = sumPriorityPerGas / BigInt(txWithPrices);
            const queryStart = Date.now();
            await transactionClient.query(
              `UPDATE blocks SET total_fees_wei=$2, total_priority_fees_wei=$3, effective_gas_price_avg_wei=$4, priority_fee_avg_wei=$5 WHERE height=$1`,
              [
                bn,
                totalFees.toString(),
                totalPriorityFees.toString(),
                avgEff.toString(),
                avgPrio.toString(),
              ],
            );
            dbQueriesTotal.inc({ operation: "update" });
            dbQueryDuration.observe(
              { operation: "update" },
              (Date.now() - queryStart) / 1000,
            );
            totalTransactions += blk.transactions.length;
          }

          // Update cursor for this block (still within transaction)
          if (cfg.advanceCursor !== false) {
            const queryStart = Date.now();
            await transactionClient.query(
              `INSERT INTO ingest_cursors(module,last_processed_height) VALUES($1,$2)
           ON CONFLICT (module) DO UPDATE SET last_processed_height=EXCLUDED.last_processed_height, updated_at=NOW()`,
              ["blocks_el", bn],
            );
            dbQueriesTotal.inc({ operation: "update" });
            dbQueryDuration.observe(
              { operation: "update" },
              (Date.now() - queryStart) / 1000,
            );
          }

          // Commit transaction - block is now fully processed
          await transactionClient.query("COMMIT");

          // Update metrics after successful commit
          blocksProcessed.inc({ type: "el" }, 1);
          const blockDuration = (Date.now() - t0) / 1000;
          blocksProcessDuration.observe({ type: "el" }, blockDuration);
          if (blockDuration > 0) {
            blockProcessingRate.set({ type: "el" }, 1 / blockDuration);
          }
          currentBlockHeight.set({ type: "el" }, bn);
          blocksBehind.set({ type: "el" }, end - bn);
          nextCursor = bn;
          writeIndex++;

          if (cfg.log && bn % 100 === 0) {
            console.log(
              `EL: block ${bn} processed in ${Date.now() - t0}ms (${blk.transactions.length} txs)`,
            );
          }
        } catch (blockError) {
          // Rollback transaction on error
          if (transactionClient) {
            try {
              await transactionClient.query("ROLLBACK");
            } catch (rollbackError) {
              console.error(
                `EL: Error during rollback for block ${bn}:`,
                (rollbackError as Error).message,
              );
            }
            if ("release" in transactionClient) {
              transactionClient.release();
            }
          }

          // Log detailed error information
          const err = blockError as any;
          const errorDetails: any = {
            block_height: bn,
            message: err.message,
            stack: err.stack,
          };

          // Extract PostgreSQL error details if available
          if (err.code) {
            const pgError = {
              code: err.code,
              constraint: err.constraint,
              table: err.table,
              column: err.column,
              detail: err.detail,
              hint: err.hint,
            };

            errorDetails.postgres = pgError;

            // Map error codes
            const errorCodeMap: Record<string, string> = {
              "23503": "Foreign key violation",
              "23505": "Unique constraint violation",
              "23514": "Check constraint violation",
              "23502": "Not null constraint violation",
              "42P01": "Undefined table",
              "42703": "Undefined column",
              "42804": "Datatype mismatch",
              "23000": "Integrity constraint violation",
            };

            errorDetails.error_type =
              errorCodeMap[err.code] || `PostgreSQL error ${err.code}`;

            if (err.code === "23503") {
              errorDetails.referential_integrity = {
                constraint: err.constraint,
                table: err.table,
                detail: err.detail,
                hint: err.hint,
              };
            }
          }

          console.error(
            `EL: Error processing block ${bn}, transaction rolled back:`,
            JSON.stringify(errorDetails, null, 2),
          );
          writeIndex++;
        } finally {
          if (transactionClient && "release" in transactionClient) {
            transactionClient.release();
          }
        }
      } catch (clientError) {
        // Handle client acquisition errors
        console.error(
          `EL: Error acquiring transaction client for block ${bn}:`,
          (clientError as Error).message,
        );
        writeIndex++;
      }
    }
  };

  // Launch all 4 stages in parallel - maximum pipeline utilization
  await Promise.all([
    headerFetcherLoop(),
    txFetcherLoop(),
    receiptFetcherLoop(),
    writeLoop(),
  ]);

  if (cfg.log)
    console.log(
      `EL: window ${start}-${end} completed in ${Date.now() - t0All}ms, ${totalTransactions} transactions processed`,
    );
}
