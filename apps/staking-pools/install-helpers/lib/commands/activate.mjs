import { resolveRpcUrl, getFactoryAddress } from '../config.mjs';
import {
  assertValidatorPreflight,
  detectNetwork,
  getValidatorPubkey,
  predictPoolAddresses,
} from '../beacond.mjs';
import { createChainReader } from '../chain-reader.mjs';
import { createSignerFromEnv } from '../signers.mjs';
import { prepareActivationContext, runActivationTransaction } from '../activation.mjs';

export async function runActivate(options) {
  const env = options.env ?? process.env;
  const verbose = Boolean(options.verbose);
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const chainReader = createChainReader(rpcUrl, options.fetchImpl);
  const signer = createSignerFromEnv({
    env,
    rpcUrl,
    fetchImpl: options.fetchImpl,
    signingPreference: options.signingPreference,
  });
  const predicted = await predictPoolAddresses(factory, rpcUrl, pubkey, chainReader);

  const activationCtx = await prepareActivationContext({
    env,
    network,
    rpcUrl,
    factory,
    pubkey,
    predicted,
    chainReader,
    fetchImpl: options.fetchImpl,
    now: options.now,
    verbose,
  });

  if (activationCtx.skipped) {
    return { skipped: true };
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl,
    factory,
    chainReader,
    signer,
    verbose,
  };

  return runActivationTransaction(ctx, activationCtx);
}
