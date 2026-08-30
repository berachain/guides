import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../../lib/constants.mjs';
import { createChainReader } from '../../lib/chain-reader.mjs';
import { pinActivationSlot } from '../../lib/proofs.mjs';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

export async function createClDouble({
  rpcUrl,
  pubkey,
  validatorIndex = '36',
  includeValidator = true,
} = {}) {
  const chainReader = createChainReader(rpcUrl);
  const elLatest = BigInt(await chainReader.getBlockNumber());
  const clHead = elLatest;
  const pinnedSlot = pinActivationSlot(clHead, elLatest);
  const pinnedHex = `0x${pinnedSlot.toString(16)}`;

  const vaultResult = await chainReader.call(
    STAKING_POOL_FACTORY_BEPOLIA,
    'withdrawalVault()(address)',
  );
  const vault = String(vaultResult.decoded[0]).toLowerCase();
  const withdrawalCredentials = `0x010000000000000000000000${vault.slice(2)}`;

  const pubkeyProof = JSON.parse(readFileSync(join(fixtureDir, 'cl-proof-pubkey.json'), 'utf8'));
  const credentialsProof = JSON.parse(
    readFileSync(join(fixtureDir, 'cl-proof-credentials.json'), 'utf8'),
  );
  const balanceProof = JSON.parse(readFileSync(join(fixtureDir, 'cl-proof-balance.json'), 'utf8'));

  pubkeyProof.beacon_block_header.slot = pinnedHex;
  credentialsProof.beacon_block_header.slot = pinnedHex;
  balanceProof.beacon_block_header.slot = pinnedHex;
  credentialsProof.validator_withdrawal_credentials = withdrawalCredentials;
  pubkeyProof.validator_pubkey = pubkey;

  let validatorIncluded = includeValidator;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.includes('/eth/v1/beacon/headers/head')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: { header: { message: { slot: pinnedHex } } },
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
            index: validatorIndex,
            status: 'pending_initialized',
            balance: '10000000000000',
          },
        }),
      );
      return;
    }

    if (url.includes('/bkit/v1/proof/validator_pubkey/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(pubkeyProof));
      return;
    }

    if (url.includes('/bkit/v1/proof/validator_credentials/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(credentialsProof));
      return;
    }

    if (url.includes('/bkit/v1/proof/validator_balance/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(balanceProof));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return {
    server,
    pinnedSlot,
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
