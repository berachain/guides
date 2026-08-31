import { runColdSigningTransition } from './cold-signing.mjs';
import { exclusiveFromBlock, RECEIPT_EVENT_ABIS, recoverTxHash } from './receipt-events.mjs';
import { recordConfirmedReceipt } from './receipts.mjs';

export async function awaitConfirmedWrite({
  ctx,
  runTx,
  landedFn,
  refresh,
  action,
  addresses,
  amount,
  scanAddress,
  eventAbi,
  waitForLanding = true,
  deriveReceiptFields,
}) {
  const receiptsPath = ctx.receiptsPath;
  const env = ctx.env ?? {};

  if (ctx.signer.mode === 'hot-key') {
    const result = await runTx();
    if (result.mode === 'execute') {
      const extra = deriveReceiptFields ? await deriveReceiptFields(result.hash) : {};
      recordConfirmedReceipt({
        receiptsPath,
        env,
        action,
        hash: result.hash,
        addresses,
        amount,
        ...extra,
      });
      return { ...result, ...extra };
    }
    return result;
  }

  if (!waitForLanding) {
    return runTx();
  }

  const fromBlock = await exclusiveFromBlock(ctx.chainReader);
  const result = await runColdSigningTransition(
    {
      verbose: ctx.verbose,
      pollIntervalMs: ctx.pollIntervalMs,
      pollTimeoutMs: ctx.pollTimeoutMs,
    },
    runTx,
    landedFn,
    { refresh },
  );
  if (result?.skipped) {
    return result;
  }

  const hash = await recoverTxHash(ctx.chainReader, {
    address: scanAddress,
    eventAbi: eventAbi ?? RECEIPT_EVENT_ABIS[action],
    fromBlock,
  });
  const extra = deriveReceiptFields ? await deriveReceiptFields(hash) : {};
  recordConfirmedReceipt({
    receiptsPath,
    env,
    action,
    hash,
    addresses,
    amount,
    ...extra,
  });
  return { ...result, hash, ...extra };
}
