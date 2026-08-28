const UINT64_MAX = (1n << 64n) - 1n;
const WEI_PER_GWEI = 1_000_000_000n;

export function normalizeAddress(address) {
  const lower = String(address ?? '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(lower) ? lower : '';
}

export function beraToWei(amount, flag = 'amount') {
  const numeric = String(amount ?? '').trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(numeric)) {
    throw new Error(`${flag} must be a positive number`);
  }
  const [whole, fraction = ''] = numeric.split('.');
  if (fraction.length > 18) {
    throw new Error(`${flag} has more than 18 decimal places`);
  }
  const padded = `${whole}${fraction.padEnd(18, '0').slice(0, 18)}`;
  const wei = padded.replace(/^0+/, '') || '0';
  if (wei === '0') {
    throw new Error(`${flag} must be greater than 0`);
  }
  return { decimal: numeric, wei };
}

export function beraToGwei(amount, flag = 'amount') {
  const { decimal, wei } = beraToWei(amount, flag);
  const weiBig = BigInt(wei);
  if (weiBig % WEI_PER_GWEI !== 0n) {
    throw new Error(`${flag} must be a multiple of 1 gwei (1e-9 BERA)`);
  }
  const gwei = weiBig / WEI_PER_GWEI;
  if (gwei > UINT64_MAX) {
    throw new Error(`${flag} exceeds uint64 gwei`);
  }
  return { decimal, wei, gwei: gwei.toString() };
}
