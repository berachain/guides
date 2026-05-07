import type { Hex } from "viem";

/** Per-chain capability object returned by wallet_getCapabilities */
export interface ChainAtomicBatchCapability {
  supported?: boolean;
  status?: "supported" | "unsupported" | "ready" | string;
}

export interface ChainAtomicCapability {
  status?: "supported" | "unsupported" | "ready" | string;
  supported?: boolean;
}

export interface ChainCapabilitiesEntry {
  /** Older ERC-5792 examples expose atomic batching here. */
  atomicBatch?: ChainAtomicBatchCapability;
  /** MetaMask currently exposes batch support as atomic.status. */
  atomic?: ChainAtomicCapability;
}

/** wallet_getCapabilities returns a map keyed by 0x-prefixed chain id */
export type WalletCapabilitiesMap = Record<
  string,
  ChainCapabilitiesEntry | undefined
>;

export interface WalletCall {
  to: Hex;
  data: Hex;
  value?: Hex;
}

export type CallsId = string;

export interface SendCallsParamsV2 {
  version: "2.0.0";
  chainId: Hex;
  calls: WalletCall[];
  capabilities: Record<string, unknown>;
  /** MetaMask expects this flag for atomic batch execution. */
  atomicRequired?: boolean;
}

export type CallsStatusCode = 100 | 200 | 400 | number;

export interface CallsStatusResult {
  status: CallsStatusCode;
  /** Some wallets return transaction hash(es) on success */
  transactionHash?: Hex;
  receipts?: readonly { transactionHash?: Hex }[];
  /** Failure reason when status is 400 */
  reason?: string;
  message?: string;
}

export class ERC5792RpcError extends Error {
  readonly code: string | number | undefined;

  constructor(message: string, code?: string | number) {
    super(message);
    this.name = "ERC5792RpcError";
    this.code = code;
  }
}
