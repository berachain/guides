#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { checkDependencies, formatMissingDependency } from './lib/deps.mjs';
import { logError } from './lib/log.mjs';
import { runDeploy } from './lib/commands/deploy.mjs';
import { runActivate } from './lib/commands/activate.mjs';
import { runStatus } from './lib/commands/status.mjs';
import { runSetMinBalance } from './lib/commands/set-min-balance.mjs';
import { runStake } from './lib/commands/stake.mjs';
import { runUnstake } from './lib/commands/unstake.mjs';

function printRootHelp() {
  console.log(`pool-cli — staking pool operator helper (Node stdlib + cast + beacond)

Run on the validator host with BEACOND_HOME set. Dry-run by default; prints copy-paste
cast send for ledger signing on another machine. Optional --execute requires PRIVATE_KEY.

Usage:
  node pool-cli.mjs <command> [options]

Commands:
  deploy          Deploy staking pool contracts (dry-run + emit default)
  activate        Activate a deployed pool with CL proofs (dry-run + emit default)
  status          EL operator, beacon inclusion, and pool isActive
  set-min-balance Optional min effective balance update (dry-run + emit default)
  stake           Deposit BERA, mint stBERA to --receiver (dry-run + emit default)
  unstake         Request or finalize withdrawal (dry-run + emit default)

Global options:
  --execute       Broadcast on validator (requires PRIVATE_KEY; hot key only)
  --help          Show command help

Stake:
  --amount BERA --receiver 0x... [--from 0x...] [--staking-pool 0x...]

Unstake:
  --amount BERA | --shares stBERA | --finalize REQUEST_ID
  --from 0x...   stBERA holder (or --receiver as alias; or PRIVATE_KEY)
  [--staking-pool 0x...] [--max-fee BERA]

Environment:
  BEACOND_HOME (required), BEACOND_BIN, CLI_CHAIN, RPC_URL, EL_RPC_URL
  CL_NODE_API_URL or NODE_API_ADDRESS (default http://127.0.0.1:3500)
  PRIVATE_KEY (required for --execute on validator)
`);
}

function parseGlobal(args) {
  const execute = args.includes('--execute');
  const help = args.includes('--help') || args.includes('-h');
  const filtered = args.filter((arg) => arg !== '--execute');
  return { execute, help, args: filtered };
}

function parseFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseDeployArgs(args) {
  return {
    operator: parseFlagValue(args, '--op') ?? '',
    sharesRecipient: parseFlagValue(args, '--sr') ?? '',
  };
}

function parseActivateArgs(args) {
  const nowRaw = parseFlagValue(args, '--now');
  return {
    now: nowRaw !== undefined ? Number(nowRaw) : undefined,
  };
}

function parseSetMinBalanceArgs(args) {
  return {
    amount: parseFlagValue(args, '--amount'),
  };
}

function parseStakeArgs(args) {
  return {
    amount: parseFlagValue(args, '--amount'),
    receiver: parseFlagValue(args, '--receiver'),
    from: parseFlagValue(args, '--from'),
    stakingPool: parseFlagValue(args, '--staking-pool'),
  };
}

function parseUnstakeArgs(args) {
  return {
    amount: parseFlagValue(args, '--amount'),
    shares: parseFlagValue(args, '--shares'),
    finalize: parseFlagValue(args, '--finalize'),
    from: parseFlagValue(args, '--from'),
    receiver: parseFlagValue(args, '--receiver'),
    stakingPool: parseFlagValue(args, '--staking-pool'),
    maxFee: parseFlagValue(args, '--max-fee'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printRootHelp();
    return 0;
  }

  const command = argv[0];
  const rest = argv.slice(1);
  const { execute, help, args } = parseGlobal(rest);

  if (help) {
    printRootHelp();
    return 0;
  }

  const missing = checkDependencies();
  if (missing.length > 0) {
    logError(formatMissingDependency(missing[0]));
    return 1;
  }

  try {
    switch (command) {
      case 'deploy':
        await runDeploy({ ...parseDeployArgs(args), execute });
        return 0;
      case 'activate':
        await runActivate({ ...parseActivateArgs(args), execute });
        return 0;
      case 'status':
        await runStatus();
        return 0;
      case 'set-min-balance':
        await runSetMinBalance({ ...parseSetMinBalanceArgs(args), execute });
        return 0;
      case 'stake':
        await runStake({ ...parseStakeArgs(args), execute });
        return 0;
      case 'unstake':
        await runUnstake({ ...parseUnstakeArgs(args), execute });
        return 0;
      default:
        logError(`Unknown command: ${command}`);
        printRootHelp();
        return 1;
    }
  } catch (error) {
    logError(error.message);
    return 1;
  }
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
