import { Pool, Client } from "pg";
import { RoundRobinProvider } from "../rpc-balancer.js";
import { classifyClient, decodeExtraDataAscii } from "../decoders.js";
import {
  classifyTransactionType,
  parseEIP7702Transaction,
  parseBlobTransaction,
  parseAccessListTransaction,
} from "./el.js";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface RetryFailedBlocksConfig {
  elRpcUrls: string[];
  log?: boolean;
  shouldShutdown?: () => boolean;
}

// Retry failed blocks independently without affecting the main cursor
// This processes failed blocks in a separate worker that doesn't touch the cursor
export async function retryFailedBlocks(
  pg: Pool | Client,
  cfg: RetryFailedBlocksConfig,
): Promise<void> {
  // Get list of failed blocks to retry (limit to avoid processing too many at once)
  const failedRes = await pg.query(
    `SELECT DISTINCT block_height 
     FROM failed_blocks 
     WHERE module = 'blocks_el' AND resolved_at IS NULL
     ORDER BY block_height
     LIMIT 10`,
  );
  if (failedRes.rows.length === 0) {
    return; // No failed blocks to retry
  }
  const failedHeights = failedRes.rows.map((r) => Number(r.block_height));
  const provider = new RoundRobinProvider(cfg.elRpcUrls);
  if (cfg.log) {
    console.log(
      `EL: Retrying ${failedHeights.length} failed blocks (${Math.min(...failedHeights)}-${Math.max(...failedHeights)})`,
    );
  }
  // Process each failed block directly
  for (const bn of failedHeights) {
    if (cfg.shouldShutdown && cfg.shouldShutdown()) break;
    const isPool = "query" in pg;
    let transactionClient: Pool | Client | null = null;
    try {
      // Delete existing data for this block first
      await pg.query(`DELETE FROM blocks WHERE height = $1`, [bn]);
      if (cfg.log) {
        console.log(
          `EL: Deleted existing data for failed block ${bn} before retry`,
        );
      }
      // Fetch block header
      const blk = await provider.getBlock(bn);
      if (!blk) {
        throw new Error(`Failed to fetch block ${bn}`);
      }
      const txHashes = blk.transactions;
      const txMap = new Map<string, any>();
      const receiptMap = new Map<string, any>();
      // Fetch transactions and receipts in parallel
      await Promise.all([
        ...txHashes.map(async (h: string) => {
          try {
            const tx = await provider.getTransaction(h);
            txMap.set(h.toLowerCase(), tx);
          } catch (e) {
            // Continue with available transactions
          }
        }),
        ...txHashes.map(async (h: string) => {
          try {
            const receipt = await provider.getTransactionReceipt(h);
            receiptMap.set(h.toLowerCase(), receipt);
          } catch (e) {
            // Continue with available receipts
          }
        }),
      ]);
      // Match transactions and receipts
      const allItems = txHashes.map((h: string) => {
        const hashLower = h.toLowerCase();
        const tx = txMap.get(hashLower);
        const receipt = receiptMap.get(hashLower);
        if (tx && receipt) {
          return { tx, receipt };
        }
        return null;
      });
      // Start transaction
      if (isPool) {
        transactionClient = await (pg as Pool).connect();
        await transactionClient.query("BEGIN");
      } else {
        transactionClient = pg;
        await transactionClient.query("BEGIN");
      }
      // Insert block header
      const baseFee = blk.baseFeePerGas ? BigInt(blk.baseFeePerGas) : null;
      const extra = blk.extraData;
      const decoded = decodeExtraDataAscii(extra);
      const chainClientInfo = classifyClient(decoded);
      const gasLimit = blk.gasLimit ? BigInt(blk.gasLimit) : null;
      await transactionClient.query(
        `INSERT INTO blocks(height, el_hash, timestamp, proposer_address, base_fee_per_gas_wei, gas_used_total, gas_limit, tx_count, chain_client, chain_client_type, chain_client_version)
         VALUES($1,$2,to_timestamp($3), NULL, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (height) DO UPDATE SET
           el_hash=EXCLUDED.el_hash,
           timestamp=EXCLUDED.timestamp,
           base_fee_per_gas_wei=EXCLUDED.base_fee_per_gas_wei,
           gas_used_total=EXCLUDED.gas_used_total,
           gas_limit=EXCLUDED.gas_limit,
           tx_count=EXCLUDED.tx_count,
           chain_client=EXCLUDED.chain_client,
           chain_client_type=EXCLUDED.chain_client_type,
           chain_client_version=EXCLUDED.chain_client_version`,
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
      let sumEffPrice = 0n;
      let sumPriorityPerGas = 0n;
      let txWithPrices = 0;
      let totalFees = 0n;
      let totalPriorityFees = 0n;
      const baseFeeWei = blk.baseFeePerGas ? BigInt(blk.baseFeePerGas) : 0n;
      // Process transactions
      for (const item of allItems) {
        if (!item) continue;
        const { tx, receipt } = item;
        if (!tx || !receipt) continue;
        const selector =
          tx.data && tx.data.length >= 10
            ? ("0x" + tx.data.slice(2, 10)).toLowerCase()
            : null;
        const inputSize = tx.data ? (tx.data.length - 2) / 2 : 0;
        const createsContract = !tx.to;
        const createdAddress = receipt?.contractAddress || null;
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
        // Derive fee metrics
        const effPriceHex = receipt.effectiveGasPrice;
        const gasUsedHex = receipt.gasUsed;
        const effPrice = effPriceHex ? BigInt(effPriceHex) : 0n;
        const gasUsed = gasUsedHex ? BigInt(gasUsedHex) : 0n;
        const prioPerGas = effPrice > baseFeeWei ? effPrice - baseFeeWei : 0n;
        const totalFee = gasUsed * effPrice;
        const totalPrioFee = gasUsed * prioPerGas;
        const statusHex = receipt.status;
        const statusBool = statusHex ? parseInt(statusHex, 16) === 1 : null;
        const gasUsedHexR = receipt.gasUsed;
        const cumGasHex = receipt.cumulativeGasUsed;
        const effPriceHexR = receipt.effectiveGasPrice;
        const transactionCategory = classifyTransactionType(tx);
        const eip7702Data = parseEIP7702Transaction(tx);
        const blobData = parseBlobTransaction(tx);
        const accessListData = parseAccessListTransaction(tx);
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
            tx.gasLimit ? BigInt(tx.gasLimit).toString() : null,
            tx.maxFeePerGas ? BigInt(tx.maxFeePerGas).toString() : null,
            tx.maxPriorityFeePerGas
              ? BigInt(tx.maxPriorityFeePerGas).toString()
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
        // Handle contract creation
        if (createsContract && createdAddress) {
          await transactionClient.query(
            `INSERT INTO contracts(address, created_by_tx, created_at_block, bytecode_hash, is_proxy, implementation_address)
             VALUES($1,$2,$3,NULL,NULL,NULL)
             ON CONFLICT (address) DO NOTHING`,
            [createdAddress.toLowerCase(), tx.hash, bn],
          );
        }
        // Aggregate fee metrics
        if (effPriceHex && gasUsedHex) {
          sumEffPrice += effPrice;
          sumPriorityPerGas += prioPerGas;
          totalFees += totalFee;
          totalPriorityFees += totalPrioFee;
          txWithPrices++;
        }
      }
      // Update block aggregates
      if (txWithPrices > 0) {
        const avgEff = sumEffPrice / BigInt(txWithPrices);
        const avgPrio = sumPriorityPerGas / BigInt(txWithPrices);
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
      }
      // Commit transaction
      await transactionClient.query("COMMIT");
      // Success - delete from failed_blocks
      await pg.query(
        `DELETE FROM failed_blocks 
         WHERE block_height = $1 AND module = 'blocks_el'`,
        [bn],
      );
      if (cfg.log) {
        console.log(
          `EL: Successfully retried block ${bn}, removed from failed_blocks`,
        );
      }
    } catch (e) {
      if (transactionClient) {
        try {
          await transactionClient.query("ROLLBACK");
        } catch (rollbackError) {
          // Ignore rollback errors
        }
        if ("release" in transactionClient) {
          (transactionClient as any).release();
        }
      }
      const err = e as Error;
      console.error(`EL: Retry failed for block ${bn}:`, err.message);
      // Failed block entry will remain for next retry attempt
    } finally {
      if (transactionClient && "release" in transactionClient) {
        (transactionClient as any).release();
      }
    }
  }
}
