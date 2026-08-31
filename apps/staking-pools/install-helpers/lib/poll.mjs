export function pollUntil(predicate, { intervalMs = 1000, timeoutMs = 120000, deadlineAt } = {}) {
  const start = Date.now();
  const hardDeadline = deadlineAt !== undefined ? Math.min(start + timeoutMs, deadlineAt) : start + timeoutMs;
  return new Promise((resolve) => {
    const tick = async () => {
      if (await predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() >= hardDeadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
