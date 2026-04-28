import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { HDKey } from '@scure/bip32';

export const EVM_DERIVATION_PATH_BASE = "m/44'/60'/0'/0";

const HEX_RE = /^[0-9a-fA-F]*$/;

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error('hexToBytes: hex string must have even length');
  }
  if (!HEX_RE.test(normalized)) {
    throw new Error('hexToBytes: invalid hex string');
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deriveEvmAddress(seed: Uint8Array, accountIndex: number): string {
  if (seed.length !== 64) {
    throw new Error('deriveEvmAddress: expected 64-byte BIP39 seed');
  }
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error('deriveEvmAddress: account index must be a non-negative integer');
  }

  const path = `${EVM_DERIVATION_PATH_BASE}/${accountIndex}`;
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(path);
  if (child.privateKey === null) {
    throw new Error('deriveEvmAddress: derived key is missing private key material');
  }

  const pubKey = secp256k1.getPublicKey(child.privateKey, false);
  const pubKeyXY = pubKey.slice(1);
  const hashed = keccak_256(pubKeyXY);
  const addressBytes = hashed.slice(-20);
  return toChecksumAddress(addressBytes);
}

export function toChecksumAddress(addressBytes: Uint8Array): string {
  if (addressBytes.length !== 20) {
    throw new Error('toChecksumAddress: expected 20-byte address');
  }

  const lower = bytesToHex(addressBytes);
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let checksummed = '';
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower[i];
    if (char === undefined) throw new Error('toChecksumAddress: invalid address hex');
    const hashNibble = Number.parseInt(hash[i] ?? '0', 16);
    checksummed += hashNibble >= 8 ? char.toUpperCase() : char;
  }
  return `0x${checksummed}`;
}

export function isValidEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;

  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) {
    return true;
  }
  return toChecksumAddress(hexToBytes(body)) === address;
}
