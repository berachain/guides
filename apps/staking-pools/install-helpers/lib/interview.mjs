import { formatCreateValidatorCommand, parseDepositOutput, runBeacond } from './beacond.mjs';
import { promptLine } from './prompt.mjs';
import { resolveSignerMode } from './signers.mjs';

export function resolveValidatorLocality(env = process.env) {
  const home = env.BEACOND_HOME?.trim();
  if (!home) {
    return { locality: 'remote', reason: 'BEACOND_HOME unset' };
  }
  const result = runBeacond(['deposit', 'validator-keys'], env);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'beacond deposit validator-keys failed';
    return { locality: 'remote', reason: 'keys unreadable', detail, home };
  }
  return { locality: 'local', home };
}

function suppliedNetwork(env, options) {
  return Boolean(options.network?.trim() || env.CLI_CHAIN?.trim());
}

function suppliedPubkey(env, options) {
  return Boolean(options.pubkey?.trim() || env.VALIDATOR_PUBKEY?.trim());
}

function suppliedDeposit(options) {
  return Boolean(options.deposit || options.depositOutput?.trim());
}

export function collectMissingFacts({
  locality,
  env = {},
  options = {},
  deploying = false,
}) {
  const missing = [];
  if (locality === 'remote') {
    if (!suppliedNetwork(env, options)) {
      missing.push({ fact: 'chain', flag: '--chain', envVar: 'CLI_CHAIN' });
    }
    if (!suppliedPubkey(env, options)) {
      missing.push({ fact: 'pubkey', flag: '--pubkey', envVar: 'VALIDATOR_PUBKEY' });
    }
    if (deploying && !suppliedDeposit(options)) {
      missing.push({ fact: 'deposit', flag: '--deposit-output' });
    }
  }
  if (resolveSignerMode(env) === 'cold-signing') {
    if (!options.fundingAddress) {
      missing.push({ fact: 'funding-address', flag: '--funding-address' });
    }
    if (!options.signingPreference) {
      missing.push({ fact: 'signing-preference', flag: '--signing-preference' });
    }
  }
  return missing;
}

export function formatMissingFactsError(missing) {
  const names = missing.map((entry) => {
    if (entry.envVar) return `${entry.flag} or ${entry.envVar}`;
    return entry.flag;
  });
  return (
    `Non-interactive stdin cannot prompt for missing facts. Supply ${names.join(', ')} ` +
    'via flags or environment variables.'
  );
}

export function assertTtyAllowsPrompts(missing, isTTY) {
  if (missing.length === 0) return;
  if (!isTTY) {
    throw new Error(formatMissingFactsError(missing));
  }
}

export function resolveInterviewNetwork(env = {}, options = {}) {
  return (options.network?.trim() || env.CLI_CHAIN?.trim() || '').toLowerCase();
}

export function resolveInterviewPubkey(env = {}, options = {}) {
  return (options.pubkey?.trim() || env.VALIDATOR_PUBKEY?.trim() || '');
}

export async function conductInterview({
  locality,
  env = {},
  options = {},
  deploying = false,
  isTTY = process.stdin.isTTY,
  skipTtyCheck = false,
  promptImpl,
  promptOptions = {},
} = {}) {
  const missing = collectMissingFacts({ locality, env, options, deploying });
  if (!skipTtyCheck) {
    assertTtyAllowsPrompts(missing, isTTY);
  }

  const ask = promptImpl ?? ((question) => promptLine(question, promptOptions));
  const asked = [];
  const answers = {
    network: resolveInterviewNetwork(env, options),
    pubkey: resolveInterviewPubkey(env, options),
    deposit: options.deposit ?? null,
    fundingAddress: options.fundingAddress ?? '',
    signingPreference: options.signingPreference ?? '',
  };

  for (const fact of missing) {
    asked.push(fact.fact);
    if (fact.fact === 'chain') {
      const raw = await ask('Chain [mainnet/bepolia]: ');
      const network = String(raw ?? '').trim().toLowerCase();
      if (network !== 'mainnet' && network !== 'bepolia') {
        throw new Error('Chain must be mainnet or bepolia');
      }
      answers.network = network;
    } else if (fact.fact === 'pubkey') {
      const raw = String(await ask('Validator pubkey (48-byte hex): ')).trim();
      if (!/^0x[0-9a-fA-F]{96}$/.test(raw)) {
        throw new Error('Validator pubkey must be a 48-byte hex value');
      }
      answers.pubkey = raw;
    } else if (fact.fact === 'deposit') {
      if (options.withdrawalVault && answers.network) {
        const command = formatCreateValidatorCommand(options.withdrawalVault, answers.network);
        console.log(`Run on the validator host:\n${command}`);
      }
      const pasted = options.depositOutput
        ?? String(await ask('Paste beacond deposit create-validator output, then a blank line: '));
      answers.deposit = parseDepositOutput(pasted);
    } else if (fact.fact === 'funding-address') {
      const raw = String(await ask('Funding wallet address (0x...): ')).trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        throw new Error('Funding address must be a valid EVM address');
      }
      answers.fundingAddress = raw.toLowerCase();
    } else if (fact.fact === 'signing-preference') {
      const raw = String(
        await ask('Signing machine: Ledger [Enter] or type key for your own private key: '),
      ).trim();
      answers.signingPreference = raw.toLowerCase() === 'key' ? 'key' : 'ledger';
    }
  }

  return { missing, asked, answers };
}
