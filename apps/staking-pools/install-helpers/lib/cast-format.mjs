export function buildEmitWalletArgs() {
  return ['--ledger'];
}

export function formatCastCommand(argv) {
  return ['cast', ...argv].join(' ');
}

export function buildWalletArgsForCast(env = process.env) {
  const privateKey = env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required for hot-key broadcast');
  }
  return ['--private-key', privateKey];
}
