import { logWarn } from './log.mjs';
import { pollUntil } from './poll.mjs';

export async function runColdSigningTransition(plan, emitFn, landedFn, { refresh } = {}) {
  let lastCommand = '';
  const intervalMs = plan.pollIntervalMs ?? 1500;
  const timeoutMs = plan.pollTimeoutMs ?? 600000;
  while (true) {
    const result = await emitFn();
    if (result?.skipped) {
      return result;
    }
    lastCommand = result?.command ?? result?.sendArgv?.join(' ') ?? lastCommand;

    const landed = await pollUntil(landedFn, { intervalMs, timeoutMs });
    if (landed) {
      return result;
    }

    if (refresh) {
      const refreshed = await refresh();
      if (refreshed?.command && refreshed.command !== lastCommand) {
        lastCommand = refreshed.command;
      }
    }

    if (plan.verbose) {
      logWarn('Printed cast send did not land yet. Reprinting command...');
    }
  }
}
