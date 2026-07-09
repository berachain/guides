/**
 * Validator names from github.com/berachain/metadata (src/validators/*.json).
 *
 * Metadata lists validators by BLS pubkey (`id`). CL /validators returns
 * base64 pub_key values; we compress with noble to match metadata ids.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { bls12_381 } = require('@noble/curves/bls12-381.js');
const config = require('../../config');

const METADATA_CHAIN_FILES = {
  mainnet: 'mainnet.json',
  bepolia: 'bepolia.json',
};

const DEFAULT_RAW_BASE =
  'https://raw.githubusercontent.com/berachain/metadata/main/src/validators';

function normalizeAddress(address) {
  return (address || '').replace(/^0x/i, '').toUpperCase();
}

function compressClPubkey(base64Value) {
  if (!base64Value) return null;
  try {
    const raw = Buffer.from(base64Value, 'base64');
    const compressed = bls12_381.G1.Point.fromBytes(raw).toBytes(true);
    return `0x${Buffer.from(compressed).toString('hex')}`.toLowerCase();
  } catch {
    return null;
  }
}

function resolveMetadataPath(chainName) {
  const fileName = METADATA_CHAIN_FILES[chainName] || METADATA_CHAIN_FILES.mainnet;
  const envKey = chainName === 'bepolia' ? 'METADATA_BEPOLIA_VALIDATORS_PATH' : 'METADATA_MAINNET_VALIDATORS_PATH';
  if (process.env[envKey]) {
    return process.env[envKey];
  }
  if (process.env.METADATA_REPO_PATH) {
    return path.join(process.env.METADATA_REPO_PATH, 'src', 'validators', fileName);
  }
  if (config.METADATA_REPO_PATH) {
    return path.join(config.METADATA_REPO_PATH, 'src', 'validators', fileName);
  }
  return `${DEFAULT_RAW_BASE}/${fileName}`;
}

async function loadMetadataList(chainName) {
  const source = resolveMetadataPath(chainName);
  let payload;

  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await axios.get(source, { timeout: 30000 });
    payload = response.data;
  } else if (fs.existsSync(source)) {
    payload = JSON.parse(fs.readFileSync(source, 'utf8'));
  } else {
    throw new Error(`Metadata validators file not found: ${source}`);
  }

  const byPubkey = new Map();
  for (const entry of payload.validators || []) {
    if (!entry?.id || !entry?.name) continue;
    byPubkey.set(String(entry.id).toLowerCase(), entry.name);
  }

  return { source, byPubkey };
}

class MetadataValidatorNames {
  constructor(chainName = 'mainnet') {
    this.chainName = chainName;
    this.source = null;
    this.byPubkey = new Map();
    this.byAddress = new Map();
    this.loaded = false;
  }

  async load() {
    const { source, byPubkey } = await loadMetadataList(this.chainName);
    this.source = source;
    this.byPubkey = byPubkey;
    this.byAddress.clear();
    this.loaded = true;
    return this;
  }

  bindClValidators(clValidators) {
    if (!this.loaded) {
      throw new Error('MetadataValidatorNames.load() must be called first');
    }

    for (const validator of clValidators || []) {
      const address = normalizeAddress(validator.address);
      const pubkey = compressClPubkey(validator.pub_key?.value ?? validator.pub_key);
      if (!address || !pubkey) continue;

      const name = this.byPubkey.get(pubkey);
      if (name) {
        this.byAddress.set(address, name);
      }
    }
  }

  getName(address) {
    return this.byAddress.get(normalizeAddress(address)) || null;
  }

  async bindFromClRpc(baseUrl, height) {
    const response = await axios.get(`${baseUrl}/validators?per_page=99&height=${height}`);
    this.bindClValidators(response.data.result.validators);
    return this.byAddress.size;
  }
}

async function resolveValidatorNames(chainName, baseUrl, headHeight, addresses, { validatorDB } = {}) {
  const names = new Map();
  const metadata = new MetadataValidatorNames(chainName);

  try {
    await metadata.load();
    await metadata.bindFromClRpc(baseUrl, headHeight);
    for (const address of addresses) {
      const name = metadata.getName(address);
      if (name) names.set(normalizeAddress(address), name);
    }
  } catch (error) {
    // Fall back to sqlite below; metadata may be offline on playground.
    if (process.env.DEBUG_METADATA) {
      console.error(`metadata name lookup failed: ${error.message}`);
    }
  }

  if (validatorDB) {
    await Promise.all(addresses.map(async (address) => {
      const key = normalizeAddress(address);
      if (names.has(key)) return;
      const name = await validatorDB.getValidatorName(address);
      if (name) names.set(key, name);
    }));
  }

  return { names, metadataSource: metadata.source };
}

module.exports = {
  MetadataValidatorNames,
  compressClPubkey,
  loadMetadataList,
  normalizeAddress,
  resolveMetadataPath,
  resolveValidatorNames,
};
