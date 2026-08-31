import { logWarn } from './log.mjs';
import { pollUntil } from './poll.mjs';

// Leave this much time before a fetched proof's real on-chain expiry: refresh
// and reprint while the operator still has a full window to act, rather than
// waiting for the old proof to actually expire before doing anything.
const PROOF_REFRESH_BUFFER_MS = 60000;

export async function runColdSigningTransition(plan, emitFn, landedFn, { refresh } = {}) {
  let lastCommand = '';
  let expiresAtSeconds;
  const intervalMs = plan.pollIntervalMs ?? 1500;
  const timeoutMs = plan.pollTimeoutMs ?? 600000;
  while (true) {
    const result = await emitFn();
    if (result?.skipped) {
      return result;
    }
    lastCommand = result?.command ?? result?.sendArgv?.join(' ') ?? lastCommand;
    expiresAtSeconds = result?.expiresAtSeconds ?? expiresAtSeconds;

    const deadlineAt =
      expiresAtSeconds !== undefined ? expiresAtSeconds * 1000 - PROOF_REFRESH_BUFFER_MS : undefined;
    const landed = await pollUntil(landedFn, { intervalMs, timeoutMs, deadlineAt });
    if (landed) {
      return result;
    }

    if (refresh) {
      const refreshed = await refresh();
      if (refreshed?.command && refreshed.command !== lastCommand) {
        lastCommand = refreshed.command;
      }
      expiresAtSeconds = refreshed?.expiresAtSeconds ?? expiresAtSeconds;
    }

    if (plan.verbose) {
      logWarn(
        expiresAtSeconds !== undefined
          ? 'Proof nearing expiry before it landed. Fetching a fresh proof and reprinting...'
          : 'Printed cast send did not land yet. Reprinting command...',
      );
    }
  }
}
