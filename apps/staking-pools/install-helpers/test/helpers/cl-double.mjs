import http from 'node:http';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../../lib/constants.mjs';
import { createChainReader } from '../../lib/chain-reader.mjs';
import { pinActivationSlot } from '../../lib/proofs.mjs';
import { loadValidatorProofFixtures } from './validator-proof-fixtures.mjs';

export async function createClDouble({
  rpcUrl,
  pubkey,
  validatorIndex,
  includeValidator = true,
  fixtures = loadValidatorProofFixtures(),
} = {}) {
  if (!pubkey) {
    throw new Error('createClDouble requires pubkey matching validator_proofs.json fixture');
  }
  const chainReader = createChainReader(rpcUrl);
  const elLatest = BigInt(await chainReader.getBlockNumber());
  const pinnedSlot = pinActivationSlot(elLatest, elLatest);
  const resolvedIndex = validatorIndex ?? fixtures.validatorIndex;

  const vaultResult = await chainReader.call(
    STAKING_POOL_FACTORY_BEPOLIA,
    'withdrawalVault()(address)',
  );
  const vault = String(vaultResult.decoded[0]).toLowerCase();
  const withdrawalCredentials = fixtures.withdrawalCredentials;
  const expectedVault = fixtures.withdrawalAddress.toLowerCase();
  if (vault !== expectedVault) {
    throw new Error(
      `Anvil factory withdrawalVault ${vault} does not match proof fixture ${expectedVault}. ` +
        'Call startAnvilFork() so configureAnvilForValidatorProofs runs.',
    );
  }

  const pubkeyProof = {
    beacon_block_header: { slot: '0x0' },
    validator_pubkey: pubkey,
    validator_pubkey_proof: fixtures.pubkeyProof,
  };
  const credentialsProof = {
    beacon_block_header: { slot: '0x0' },
    validator_withdrawal_credentials: withdrawalCredentials,
    withdrawal_credentials_proof: fixtures.credentialsProof,
  };
  const balanceProof = {
    beacon_block_header: { slot: '0x0' },
    validator_balance: fixtures.balance,
    balance_proof: fixtures.balanceProof,
    balance_leaf: fixtures.balanceLeaf,
  };

  let validatorIncluded = includeValidator;

  function withPinnedSlot(proof, slotHex) {
    const copy = structuredClone(proof);
    copy.beacon_block_header.slot = slotHex;
    return copy;
  }

  function slotFromProofUrl(url) {
    const match = url.match(/\/bkit\/v1\/proof\/[^/]+\/(0x[0-9a-fA-F]+|\d+)\//);
    if (!match) return null;
    const raw = match[1];
    return raw.startsWith('0x') ? raw : `0x${BigInt(raw).toString(16)}`;
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    if (url.includes('/eth/v1/beacon/headers/head')) {
      const elLatest = BigInt(await chainReader.getBlockNumber());
      const slot = pinActivationSlot(elLatest, elLatest);
      const slotHex = `0x${slot.toString(16)}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: { header: { message: { slot: slotHex } } },
        }),
      );
      return;
    }

    if (url.includes('/eth/v1/beacon/states/head/validators/')) {
      if (!validatorIncluded) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 404, message: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            index: resolvedIndex,
            status: 'pending_initialized',
            balance: fixtures.balance,
          },
        }),
      );
      return;
    }

    const requestedSlot = slotFromProofUrl(url);
    const slotHex =
      requestedSlot ??
      `0x${pinActivationSlot(
        BigInt(await chainReader.getBlockNumber()),
        BigInt(await chainReader.getBlockNumber()),
      ).toString(16)}`;

    if (url.includes('/bkit/v1/proof/validator_pubkey/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(withPinnedSlot(pubkeyProof, slotHex)));
      return;
    }

    if (url.includes('/bkit/v1/proof/validator_credentials/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(withPinnedSlot(credentialsProof, slotHex)));
      return;
    }

    if (url.includes('/bkit/v1/proof/validator_balance/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(withPinnedSlot(balanceProof, slotHex)));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return {
    server,
    pinnedSlot,
    fixtures,
    setValidatorIncluded(value) {
      validatorIncluded = value;
    },
    async listen(port = 13500) {
      await new Promise((resolve) => server.listen(port, resolve));
      return `http://127.0.0.1:${port}`;
    },
    close() {
      server.close();
    },
  };
}
