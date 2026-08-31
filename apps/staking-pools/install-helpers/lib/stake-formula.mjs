import { ethers } from './ethers-bundle.mjs';

export const DEPOSIT_BERA = 10000;
export const HOT_KEY_GAS_BUFFER_BERA = 1;

const WEI_PER_BERA = 10n ** 18n;

export function depositWei() {
  return ethers.parseEther(String(DEPOSIT_BERA));
}

export function hotKeyGasBufferWei() {
  return ethers.parseEther(String(HOT_KEY_GAS_BUFFER_BERA));
}

export function computeAdditionalStakeBera(balanceWei, { coldSigning = false } = {}) {
  const balance = BigInt(balanceWei);
  const deposit = depositWei();
  const buffer = coldSigning ? 0n : hotKeyGasBufferWei();
  if (balance <= deposit + buffer) {
    return '0';
  }
  const stakeWei = balance - deposit - buffer;
  const wholeBera = stakeWei / WEI_PER_BERA;
  return wholeBera.toString();
}

export function computeAdditionalStakeWei(balanceWei, options = {}) {
  const bera = computeAdditionalStakeBera(balanceWei, options);
  return ethers.parseEther(bera);
}
