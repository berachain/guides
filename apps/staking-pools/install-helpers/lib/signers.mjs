import { buildEmitWalletArgs, formatCastCommand } from './cast-format.mjs';
import {
  ethCallRevertData,
  formatCalldataArgsForCast,
  sendContractTransaction,
  walletAddressFromPrivateKey,
} from './chain-reader.mjs';
import { ethers } from './ethers-bundle.mjs';
import { logInfo, logSuccess } from './log.mjs';
import { pollUntil, sleep } from './poll.mjs';

export function createHotKeySigner({ env, rpcUrl, fetchImpl }) {
  const privateKey = env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required for hot-key signing');
  }

  return {
    mode: 'hot-key',
    async getFundingAddress() {
      return (await walletAddressFromPrivateKey(privateKey)).toLowerCase();
    },
    async broadcast({ target, signature, args, value = 0n, label, verbose }) {
      if (verbose) {
        logInfo(`Broadcasting ${label} via vendored ethers wallet...`);
      }
      const result = await sendContractTransaction({
        rpcUrl,
        privateKey,
        to: target,
        signature,
        args,
        value,
        fetchImpl,
      });
      if (verbose) {
        logSuccess(`${label} broadcast: ${result.hash}`);
      }
      return result;
    },
    formatCastSend() {
      return '';
    },
    emitCastSend() {
      throw new Error('Hot-key mode does not emit cast send commands');
    },
  };
}

export function createColdSigningSigner({ rpcUrl, signingPreference = 'ledger' }) {
  return {
    mode: 'cold-signing',
    signingPreference,
    formatCastSend({ target, signature, args, value }) {
      const calldataArgs = formatCalldataArgsForCast(signature, args);
      const argv = [
        'send',
        target,
        signature,
        ...calldataArgs,
        '--legacy',
        '-r',
        rpcUrl,
        ...(signingPreference === 'key'
          ? ['--private-key', '<YOUR_PRIVATE_KEY>']
          : buildEmitWalletArgs()),
      ];
      if (value && value > 0n) {
        argv.push('--value', `${ethers.formatEther(value)}ether`);
      }
      return formatCastCommand(argv);
    },
    emitCastSend(ctx) {
      const command = this.formatCastSend(ctx);
      logInfo('Copy and run on your signing machine (ledger on laptop):');
      console.log(command);
      console.log('');
      return command;
    },
    async broadcast() {
      throw new Error('Cold-signing mode never broadcasts transactions');
    },
  };
}

export function resolveSignerMode(env = process.env) {
  return env.PRIVATE_KEY?.trim() ? 'hot-key' : 'cold-signing';
}

export function createSignerFromEnv({ env = process.env, rpcUrl, fetchImpl, signingPreference }) {
  const mode = resolveSignerMode(env);
  if (mode === 'hot-key') {
    return createHotKeySigner({ env, rpcUrl, fetchImpl });
  }
  return createColdSigningSigner({ rpcUrl, signingPreference: signingPreference ?? 'ledger' });
}
