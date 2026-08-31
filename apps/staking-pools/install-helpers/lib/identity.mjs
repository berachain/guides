import { join } from 'node:path';
import { detectNetwork, getValidatorPubkey } from './beacond.mjs';
import { resolveValidatorLocality } from './interview.mjs';
import { DEFAULT_SCENARIO_FILENAME, readScenarioFile } from './scenario.mjs';

/**
 * Shared identity resolution for the five standalone commands that
 * BERA-960's AC-7 pointed at `install` — status, activate, set-min-balance,
 * stake, unstake (not deploy, which needs deposit fields the scenario file
 * doesn't carry). Precedence, fixed by the brief: explicit flag/env, then
 * the scenario file `install` writes, then (validator-local only) local
 * `beacond`. A source-less remote invocation still fails closed pointing at
 * `install`, unchanged from BERA-960.
 */
export function resolveStandaloneIdentity(env = process.env, options = {}) {
  const scenarioPath = options.scenarioPath ?? join(process.cwd(), DEFAULT_SCENARIO_FILENAME);
  let scenario;
  try {
    scenario = readScenarioFile(scenarioPath);
  } catch (error) {
    throw new Error(`Could not read scenario file ${scenarioPath}: ${error.message}`);
  }

  const explicitNetwork = (options.network?.trim() || env.CLI_CHAIN?.trim() || '').toLowerCase();
  const explicitPubkey = options.pubkey?.trim() || env.VALIDATOR_PUBKEY?.trim() || '';

  let network = explicitNetwork || scenario?.network || '';
  let pubkey = explicitPubkey || scenario?.pubkey || '';
  let locality = scenario?.locality || '';

  if (!network || !pubkey) {
    // Explicit values and the scenario file both fall short — only now is
    // local beacond worth the subprocess call, and only when it applies.
    const resolved = resolveValidatorLocality(env);
    locality = resolved.locality;
    if (locality === 'local') {
      if (!network) network = detectNetwork(env);
      if (!pubkey) pubkey = getValidatorPubkey(env);
    }
  }

  if (!network || !pubkey) {
    throw new Error(
      'This command needs a local validator (BEACOND_HOME with readable keys), ' +
        '--chain/--pubkey (or CLI_CHAIN/VALIDATOR_PUBKEY), or a scenario file written by ' +
        '`install` (--scenario PATH, or staking-pool-scenario.json in the working directory). ' +
        'For a remote validator, run `install` instead.',
    );
  }

  return { network, pubkey, locality, scenario };
}
