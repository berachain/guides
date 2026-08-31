import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const SCENARIO_FIELDS = Object.freeze([
  'network',
  'locality',
  'pubkey',
  'operator',
  'sharesRecipient',
]);

export const DEFAULT_SCENARIO_FILENAME = 'staking-pool-scenario.json';

export function writeScenarioFile(path, facts) {
  const recorded = {
    network: facts.network,
    locality: facts.locality,
    pubkey: facts.pubkey,
    operator: facts.operator,
    sharesRecipient: facts.sharesRecipient,
  };
  writeFileSync(path, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8');
  return recorded;
}

export function readScenarioFile(path) {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    network: String(raw.network ?? ''),
    locality: String(raw.locality ?? ''),
    pubkey: String(raw.pubkey ?? ''),
    operator: String(raw.operator ?? ''),
    sharesRecipient: String(raw.sharesRecipient ?? ''),
  };
}

export function assertScenarioMatchesIdentity(scenario, identity) {
  if (!scenario) return;
  if (identity.network && scenario.network && identity.network !== scenario.network) {
    throw new Error(
      `Scenario file network conflict: recorded ${scenario.network}, current identity is ${identity.network}.`,
    );
  }
  if (identity.pubkey && scenario.pubkey && identity.pubkey.toLowerCase() !== scenario.pubkey.toLowerCase()) {
    throw new Error(
      `Scenario file pubkey conflict: recorded ${scenario.pubkey}, current identity is ${identity.pubkey}.`,
    );
  }
}
