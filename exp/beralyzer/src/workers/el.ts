import { Client } from "pg";
import { ethers } from "ethers";
import { classifyClient, decodeExtraDataAscii } from "../decoders.js";

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
  elRpcUrl: string;
  blockBatchSize: number; // how many blocks per batch
  txConcurrency: number; // parallelism for tx/receipt fetches
  advanceCursor?: boolean; // whether to advance the cursor (default true)
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function ingestEl(
  pg: Client,
  cfg: ElWorkerConfig & { log?: boolean }
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(cfg.elRpcUrl);

  // Load cursor
  const curRes = await pg.query(
    "SELECT last_processed_height FROM ingest_cursors WHERE module=$1",
    ["blocks_el"]
  );
  const latest = await provider.getBlockNumber();
  const start = (() => {
    if (curRes.rows[0]) {
      const v = curRes.rows[0].last_processed_height;
      const n = typeof v === "number" ? v : Number(v);
      return Math.max(0, Number.isFinite(n) ? n : 0) + 1;
    }
    return 1;
  })();
  const end = latest;
  if (start > end) return; // nothing to do

  let nextCursor = start - 1;

  const t0All = Date.now();
  for (let from = start; from <= end; from += cfg.blockBatchSize) {
    const to = Math.min(end, from + cfg.blockBatchSize - 1);
    const t0 = Date.now();
    const blockNums: number[] = [];
    for (let b = from; b <= to; b++) blockNums.push(b);

    // Fetch blocks (no full transactions)
    const blocks = await Promise.all(
      blockNums.map(async (bn) => {
        try {
          const blk = await provider.getBlock(bn);
          return { bn, blk } as const;
        } catch (e) {
          return { bn, blk: null } as const;
        }
      })
    );

    // Insert blocks
    for (const { bn, blk } of blocks) {
      if (!blk) continue;
      const baseFee = blk.baseFeePerGas ? BigInt(blk.baseFeePerGas) : null;
      const extra = (blk as any).extraData as string | undefined;
      const decoded = decodeExtraDataAscii(extra);
      const chainClientInfo = classifyClient(decoded);
      const gasLimit = (blk as any).gasLimit
        ? BigInt((blk as any).gasLimit)
        : null;
      await pg.query(
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
        ]
      );
    }
    if (cfg.log)
      console.log(`EL: blocks ${from}-${to} inserted in ${Date.now() - t0}ms`);

    // For each block, fetch tx + receipt, then upsert transactions/receipts and counts
    for (const { bn, blk } of blocks) {
      if (!blk) continue;
      const txHashes: string[] = blk.transactions as any; // hashes
      let sumEffPrice = 0n;
      let sumPriorityPerGas = 0n;
      let txWithPrices = 0;
      let totalFees = 0n;
      let totalPriorityFees = 0n;

      // chunking for concurrency control
      for (let i = 0; i < txHashes.length; i += cfg.txConcurrency) {
        const chunk = txHashes.slice(i, i + cfg.txConcurrency);
        const items = await Promise.all(
          chunk.map(async (h) => {
            try {
              const [tx, receiptRaw] = await Promise.all([
                provider.getTransaction(h),
                provider.send("eth_getTransactionReceipt", [h]),
              ]);
              return { tx, receipt: receiptRaw as any } as const;
            } catch (e) {
              return null;
            }
          })
        );

        for (const item of items) {
          if (!item) continue;
          const { tx, receipt } = item;
          if (!tx || !receipt) continue;
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
              if ((log.topics?.[0] || "").toLowerCase() === TRANSFER_TOPIC) {
                transferCount++;
                if (log.address) tokenSet.add(log.address.toLowerCase());
              }
            }
          }

          // Derive fee metrics if available
          const baseFeeWei = blk.baseFeePerGas ? BigInt(blk.baseFeePerGas) : 0n;
          const effPriceHex = (receipt as any).effectiveGasPrice as
            | string
            | undefined;
          const gasUsedHex = (receipt as any).gasUsed as string | undefined;
          const effPrice = effPriceHex ? BigInt(effPriceHex) : 0n;
          const gasUsed = gasUsedHex ? BigInt(gasUsedHex) : 0n;
          const prioPerGas = effPrice > baseFeeWei ? effPrice - baseFeeWei : 0n;
          const totalFee = gasUsed * effPrice;
          const totalPrioFee = gasUsed * prioPerGas;

          if (effPriceHex && gasUsedHex) {
            sumEffPrice += effPrice;
            sumPriorityPerGas += prioPerGas;
            totalFees += totalFee;
            totalPriorityFees += totalPrioFee;
            txWithPrices++;
          }

          const statusHex = (receipt as any).status as string | undefined;
          const statusBool = statusHex ? parseInt(statusHex, 16) === 1 : null;
          const gasUsedHexR = (receipt as any).gasUsed as string | undefined;
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

          await pg.query(
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
              tx.type ?? null,
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
            ]
          );

          if (createsContract && createdAddress) {
            await pg.query(
              `INSERT INTO contracts(address, created_by_tx, created_at_block, bytecode_hash, is_proxy, implementation_address)
               VALUES($1,$2,$3,NULL,NULL,NULL)
               ON CONFLICT (address) DO NOTHING`,
              [createdAddress.toLowerCase(), tx.hash, bn]
            );
          }
        }
      }

      // After processing txs for this block, update block aggregates if we had prices
      if (txWithPrices > 0) {
        const avgEff = sumEffPrice / BigInt(txWithPrices);
        const avgPrio = sumPriorityPerGas / BigInt(txWithPrices);
        await pg.query(
          `UPDATE blocks SET total_fees_wei=$2, total_priority_fees_wei=$3, effective_gas_price_avg_wei=$4, priority_fee_avg_wei=$5 WHERE height=$1`,
          [
            bn,
            totalFees.toString(),
            totalPriorityFees.toString(),
            avgEff.toString(),
            avgPrio.toString(),
          ]
        );
      }
    }

    nextCursor = to;

    // Only advance cursor if explicitly allowed
    if (cfg.advanceCursor !== false) {
      await pg.query(
        `INSERT INTO ingest_cursors(module,last_processed_height) VALUES($1,$2)
         ON CONFLICT (module) DO UPDATE SET last_processed_height=EXCLUDED.last_processed_height, updated_at=NOW()`,
        ["blocks_el", nextCursor]
      );
    } else {
      console.log("Cursor advancement disabled, staying at current position");
    }
  }
  if (cfg.log)
    console.log(
      `EL: window ${start}-${end} completed in ${Date.now() - t0All}ms`
    );
}
