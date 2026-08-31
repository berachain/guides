import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACTS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../contracts-staking-pools',
);

const FIXTURE_PATH = join(CONTRACTS_ROOT, 'test/fixtures/validator_proofs.json');

/** Real Electra SSZ proofs from forge tests — coherent beacon block root + index 0 paths. */
export function loadValidatorProofFixtures(fixturePath = FIXTURE_PATH) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const withdrawalAddress = raw.$3__withdrawalAddress;
  const withdrawalCredentials =
    `0x010000000000000000000000${withdrawalAddress.slice(2).toLowerCase()}`;

  return {
    beaconBlockRoot: raw.$0__beaconBlockRoot,
    validatorIndex: String(raw.$1__index),
    pubkey: raw.$2__pubkey,
    withdrawalAddress,
    withdrawalCredentials,
    balance: String(raw.$7__balance),
    balanceLeaf: raw.$8__balanceLeaf,
    pubkeyProof: raw.$4__pubkeyProof,
    credentialsProof: raw.$5__withdrawalCredentialsProof,
    balanceProof: raw.$6__balanceProof,
  };
}

export const FIXTURE_PATH_DEFAULT = FIXTURE_PATH;
