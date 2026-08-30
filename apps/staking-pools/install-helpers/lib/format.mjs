import { ethers } from './ethers-bundle.mjs';

export function stripScientificNotation(raw) {
  const first = String(raw ?? '').trim().split(/\s+/)[0];
  if (/^-?[0-9]+(\.[0-9]+)?[eE][+-]?[0-9]+$/.test(first)) {
    return BigInt(Math.round(Number(first))).toString();
  }
  return first;
}

export function formatWeiToDecimal(wei, unit = 'ether') {
  const normalized = stripScientificNotation(wei);
  if (!/^[0-9]+$/.test(normalized)) {
    return normalized;
  }
  if (unit === 'ether') {
    return ethers.formatEther(normalized);
  }
  if (unit === 'gwei') {
    return ethers.formatUnits(normalized, 'gwei');
  }
  return normalized;
}

export function formatBeraAmount(wei) {
  const decimal = formatWeiToDecimal(wei, 'ether');
  const numeric = Number(decimal);
  if (Number.isFinite(numeric) && Number.isInteger(numeric)) {
    return numeric.toLocaleString('en-US');
  }
  return decimal;
}

export function parseCastTuple(raw) {
  const normalized = String(raw)
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .trim();
  return normalized
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function unwrapCastJson(raw) {
  const parsed = JSON.parse(String(raw ?? '').trim() || 'null');
  if (parsed && typeof parsed === 'object' && 'schema_version' in parsed) {
    if (parsed.success === false) {
      const errors = Array.isArray(parsed.errors) ? parsed.errors.filter(Boolean).join('; ') : '';
      throw new Error(errors || 'cast --json returned success=false');
    }
    return parsed.data;
  }
  return parsed;
}

export function parseCastBlockNumber(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error('block-number returned empty output');
  }
  if (trimmed.startsWith('{')) {
    const data = unwrapCastJson(trimmed);
    if (data && typeof data === 'object' && data.number != null) {
      return parseProofSlot(data.number);
    }
    return parseProofSlot(data);
  }
  return parseProofSlot(trimmed.split(/\s+/)[0]);
}

function parseProofSlot(slotValue) {
  if (typeof slotValue === 'number') return BigInt(slotValue);
  const raw = String(slotValue).trim();
  if (raw.startsWith('0x') || raw.startsWith('0X')) {
    return BigInt(raw);
  }
  if (/^[0-9]+$/.test(raw)) {
    return BigInt(raw);
  }
  throw new Error(`Non-numeric slot: ${slotValue}`);
}
