export function pollUntil(predicate, { intervalMs = 1000, timeoutMs = 120000 } = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
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
