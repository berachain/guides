import { PROOF_SLOT_LAG } from './constants.mjs';

export function parseProofSlot(slotValue) {
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

export function assertProofSlotMatchesPinned(proofJson, pinnedSlot) {
  const pinned = parseProofSlot(pinnedSlot);
  const got = parseProofSlot(proofJson.beacon_block_header.slot);
  if (got !== pinned) {
    throw new Error(
      `Proof slot ${got.toString()} differs from pinned slot ${pinned.toString()}`,
    );
  }
}

export function extractProofFields(pubkeyProof, credentialsProof, balanceProof) {
  return {
    validatorPubkey: pubkeyProof.validator_pubkey,
    validatorWithdrawalCredentials:
      credentialsProof.validator_withdrawal_credentials,
    validatorBalance: balanceProof.validator_balance,
    pubkeyProofArray: pubkeyProof.validator_pubkey_proof,
    withdrawalCredentialsProofArray: credentialsProof.withdrawal_credentials_proof,
    balanceProofArray: balanceProof.balance_proof,
    balanceLeaf: balanceProof.balance_leaf,
    pubkeyProofCast: pubkeyProof.validator_pubkey_proof.join(','),
    withdrawalCredentialsProofCast:
      credentialsProof.withdrawal_credentials_proof.join(','),
    balanceProofCast: balanceProof.balance_proof.join(','),
  };
}

export function formatProofTuple(fields) {
  return `([${fields.pubkeyProofCast}],[${fields.withdrawalCredentialsProofCast}],[${fields.balanceProofCast}],${fields.balanceLeaf})`;
}

export function formatValidatorDataTuple(fields, validatorIndex) {
  return `(${fields.validatorPubkey},${fields.validatorWithdrawalCredentials},${fields.validatorBalance},${validatorIndex})`;
}

export function buildValidatorDataArgs(fields, validatorIndex) {
  return [
    fields.validatorPubkey,
    fields.validatorWithdrawalCredentials,
    fields.validatorBalance,
    validatorIndex,
  ];
}

export function buildProofDataArgs(fields) {
  return [
    fields.pubkeyProofArray,
    fields.withdrawalCredentialsProofArray,
    fields.balanceProofArray,
    fields.balanceLeaf,
  ];
}

export async function fetchJson(url, label = url, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`${label} unreachable: ${error.message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  if (!body.trim()) {
    throw new Error(`${label} returned empty body`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${body.slice(0, 200)}`);
  }
}

export function deriveEip4788Timestamp(pinnedSlot, elBlockJson) {
  const elBlockNumber = parseProofSlot(pinnedSlot) + 1n;
  const timestampHex = elBlockJson.timestamp;
  if (!timestampHex) {
    throw new Error(`Missing timestamp on EL block ${elBlockNumber.toString()}`);
  }
  return Number(parseProofSlot(timestampHex));
}

export function eip4788ElBlockNumber(pinnedSlot) {
  return parseProofSlot(pinnedSlot) + 1n;
}

export function pinActivationSlot(clHead, elLatest, lag = PROOF_SLOT_LAG) {
  const cl = parseProofSlot(clHead);
  const el = parseProofSlot(elLatest);
  const lagSlots = typeof lag === 'bigint' ? lag : BigInt(lag);
  if (el === 0n) {
    throw new Error('EL latest block is 0; cannot pin an activation slot');
  }
  const maxSlotForEip4788 = el - 1n;
  let slot = cl < maxSlotForEip4788 ? cl : maxSlotForEip4788;
  if (slot > lagSlots) {
    slot -= lagSlots;
  }
  if (slot === 0n) {
    throw new Error(
      `Cannot pin activation slot: CL head ${cl.toString()}, EL latest ${el.toString()}`,
    );
  }
  return slot;
}

export function proofExpiryTimestamp(proofTimestamp) {
  return proofTimestamp + 600;
}

export function isProofExpired(nowSeconds, proofTimestamp) {
  return nowSeconds >= proofExpiryTimestamp(proofTimestamp);
}
