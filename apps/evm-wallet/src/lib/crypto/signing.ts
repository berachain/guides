import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex, EVM_DERIVATION_PATH_BASE, hexToBytes } from '@/lib/crypto/evm';
import { buildWalletClient } from '@/lib/rpc/walletClient';
import { deriveSeed } from '@/lib/storage/secure';
import type { Network } from '@/lib/types';

export interface SignAndSendParams {
  walletId: string;
  accountIndex: number;
  to: `0x${string}`;
  value: bigint;
  network: Network;
  gasOverrides?: {
    maxPriorityFeePerGas?: bigint;
    maxFeePerGas?: bigint;
    gasLimit?: bigint;
  };
  authPrompt: string;
}

/**
 * This function works identically on simulator and device. The biometric prompt
 * fires only on device for SE-wrapped local wallets. iCloud-backed wallets sign
 * without a prompt because their storage path does not use the Secure Enclave.
 */
export async function signAndSendTransaction(params: SignAndSendParams): Promise<`0x${string}`> {
  let seedHex = '';
  let seed: Uint8Array | null = null;
  let privateKeyBytes: Uint8Array | null = null;
  let privateKeyHex = '';

  try {
    seedHex = await deriveSeed(params.walletId, params.authPrompt);
    seed = hexToBytes(seedHex);

    const hdKey = HDKey.fromMasterSeed(seed);
    const child = hdKey.derive(`${EVM_DERIVATION_PATH_BASE}/${params.accountIndex}`);
    if (child.privateKey === null) {
      throw new Error('signAndSendTransaction: derived key is missing private key material');
    }

    privateKeyBytes = child.privateKey;
    privateKeyHex = `0x${bytesToHex(privateKeyBytes)}`;
    const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
    const walletClient = buildWalletClient(params.network, account);

    return await walletClient.sendTransaction({
      account,
      chain: walletClient.chain,
      to: params.to,
      value: params.value,
      maxFeePerGas: params.gasOverrides?.maxFeePerGas,
      maxPriorityFeePerGas: params.gasOverrides?.maxPriorityFeePerGas,
      gas: params.gasOverrides?.gasLimit,
    });
  } finally {
    seed?.fill(0);
    privateKeyBytes?.fill(0);
    seedHex = '';
    privateKeyHex = '';
    // viem's local account keeps key material internally and JS strings cannot
    // be zeroed. Keeping those references scoped here is the available MVP
    // hygiene until signing moves fully native.
  }
}
