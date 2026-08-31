import { createInterface } from 'node:readline/promises';

export async function promptLine(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirmProceed(message = 'Proceed? [y/N] ', options = {}) {
  const answer = await promptLine(message, options);
  return /^y(es)?$/i.test(answer);
}

export async function promptFundingAddress(options = {}) {
  const address = await promptLine('Funding wallet address (0x...): ', options);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Funding address must be a valid EVM address');
  }
  return address.toLowerCase();
}

export async function promptSigningPreference(options = {}) {
  const answer = await promptLine(
    'Signing machine: Ledger [Enter] or type key for your own private key: ',
    options,
  );
  return answer.toLowerCase() === 'key' ? 'key' : 'ledger';
}
