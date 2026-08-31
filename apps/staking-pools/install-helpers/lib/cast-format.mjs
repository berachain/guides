export function buildEmitWalletArgs() {
  return ['--ledger'];
}

function needsShellQuote(value) {
  const text = String(value);
  if (text.startsWith('(') || text.startsWith('[')) {
    return true;
  }
  return /[^A-Za-z0-9_@%+=:,./-]/.test(text);
}

export function shellQuoteArg(value) {
  const text = String(value);
  if (!needsShellQuote(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function formatCastCommand(argv) {
  return ['cast', ...argv.map(shellQuoteArg)].join(' ');
}

export function buildWalletArgsForCast(env = process.env) {
  const privateKey = env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required for hot-key broadcast');
  }
  return ['--private-key', privateKey];
}
