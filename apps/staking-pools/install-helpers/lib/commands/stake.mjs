import { logInfo, logSuccess } from '../log.mjs';
import { resolveOperatorPool } from '../pool-target.mjs';
import { runTransaction } from '../tx-runner.mjs';
import { beraToWei, normalizeAddress } from '../units.mjs';

export async function runStake(options) {
  const env = options.env ?? process.env;
  const receiver = normalizeAddress(options.receiver);
  if (!receiver) {
    throw new Error('--receiver must be a valid EVM address (gets stBERA)');
  }
  const { decimal, wei } = beraToWei(options.amount, '--amount');
  const from = options.from ? normalizeAddress(options.from) : receiver;
  if (options.from && !from) {
    throw new Error('--from must be a valid EVM address');
  }

  const pool = resolveOperatorPool(options, env);

  logInfo(`Staking pool / stBERA: ${pool.stakingPool}`);
  logInfo(`Amount: ${decimal} BERA (${wei} wei)`);
  logInfo(`Receiver of stBERA: ${receiver}`);

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl: pool.rpcUrl,
    from,
    stakingPool: pool.stakingPool,
    receiver,
    value: `${decimal}ether`,
  };

  return runTransaction(ctx, {
    label: 'submit',
    target: ctx.stakingPool,
    signature: 'submit(address)',
    value: ctx.value,
    buildCalldataArgs: () => [ctx.receiver],
    decodeDryRun: async () => {
      logSuccess(`Preflight OK — submit(${ctx.receiver}) value ${ctx.value}`);
    },
  });
}
