import { deriveSeed, setSyncStateAndDeriveSeed } from '../storage/secure';
import { deriveEvmAddress, hexToBytes } from './evm';

export async function deriveAndCleanupAddress(
  walletId: string,
  accountIndex: number,
  prompt: string,
): Promise<string> {
  let seedHex = '';
  let seed: Uint8Array | null = null;
  try {
    seedHex = await deriveSeed(walletId, prompt);
    seed = hexToBytes(seedHex);
    return deriveEvmAddress(seed, accountIndex);
  } finally {
    seed?.fill(0);
    seedHex = '';
  }
}

export async function setSyncStateAndDeriveAddress(
  walletId: string,
  icloudBackedUp: boolean,
  accountIndex: number,
  prompt: string,
): Promise<string> {
  let seedHex = '';
  let seed: Uint8Array | null = null;
  try {
    seedHex = await setSyncStateAndDeriveSeed(walletId, icloudBackedUp, prompt);
    seed = hexToBytes(seedHex);
    return deriveEvmAddress(seed, accountIndex);
  } finally {
    seed?.fill(0);
    seedHex = '';
  }
}
