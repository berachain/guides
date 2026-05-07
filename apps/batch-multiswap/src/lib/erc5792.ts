import type { Hex } from 'viem'
import type { EIP1193Provider } from 'viem'
import {
  ERC5792RpcError,
  type CallsId,
  type CallsStatusResult,
  type SendCallsParamsV2,
  type WalletCapabilitiesMap,
} from '../types/erc5792'

/** viem's EIP-1193 typing does not include ERC-5792 methods yet. */
type ExtendedEip1193 = {
  request: (args: {
    method: string
    params?: readonly unknown[]
  }) => Promise<unknown>
}

const extendedProvider = (provider: EIP1193Provider): ExtendedEip1193 =>
  provider as ExtendedEip1193

const isTransactionHash = (value: unknown): value is Hex =>
  typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value)

const findTransactionHash = (
  value: unknown,
  depth = 0,
): Hex | undefined => {
  if (depth > 5) {
    return undefined
  }
  if (isTransactionHash(value)) {
    return value
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hash = findTransactionHash(item, depth + 1)
      if (hash) {
        return hash
      }
    }
    return undefined
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const row = value as Record<string, unknown>
  for (const key of ['transactionHash', 'txHash', 'hash']) {
    const hash = row[key]
    if (isTransactionHash(hash)) {
      return hash
    }
  }
  for (const nested of Object.values(row)) {
    const hash = findTransactionHash(nested, depth + 1)
    if (hash) {
      return hash
    }
  }
  return undefined
}

const parseCallsStatus = (raw: unknown): CallsStatusResult => {
  if (!raw || typeof raw !== 'object') {
    return { status: 400, reason: 'Invalid calls status payload' }
  }
  const o = raw as Record<string, unknown>
  const status = Number(o.status)
  const reason =
    typeof o.reason === 'string'
      ? o.reason
      : typeof o.message === 'string'
        ? o.message
        : undefined
  const transactionHash = findTransactionHash(o)
  const receipts = Array.isArray(o.receipts) ? o.receipts : undefined
  return {
    status: Number.isFinite(status) ? status : 400,
    transactionHash,
    receipts,
    reason,
    message: typeof o.message === 'string' ? o.message : undefined,
  }
}

const parseCallsId = (raw: unknown): CallsId => {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }
  if (!raw || typeof raw !== 'object') {
    throw new ERC5792RpcError('wallet_sendCalls returned invalid calls id')
  }

  const row = raw as Record<string, unknown>
  for (const key of ['id', 'callsId', 'batchId']) {
    const value = row[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  throw new ERC5792RpcError('wallet_sendCalls returned invalid calls id')
}

export const walletGetCapabilities = async (
  provider: EIP1193Provider,
  address: Hex,
): Promise<WalletCapabilitiesMap> => {
  try {
    const result = (await extendedProvider(provider).request({
      method: 'wallet_getCapabilities',
      params: [address],
    })) as unknown
    if (!result || typeof result !== 'object') {
      return {}
    }
    return result as WalletCapabilitiesMap
  } catch (e) {
    const err = e as { message?: string; code?: string | number }
    throw new ERC5792RpcError(
      err.message ?? 'wallet_getCapabilities failed',
      err.code,
    )
  }
}

export const walletSendCalls = async (
  provider: EIP1193Provider,
  params: SendCallsParamsV2,
): Promise<CallsId> => {
  try {
    const result = await extendedProvider(provider).request({
      method: 'wallet_sendCalls',
      params: [params],
    })
    return parseCallsId(result)
  } catch (e) {
    const err = e as { message?: string; code?: string | number }
    throw new ERC5792RpcError(
      err.message ?? 'wallet_sendCalls failed',
      err.code,
    )
  }
}

export const walletGetCallsStatus = async (
  provider: EIP1193Provider,
  batchId: CallsId,
): Promise<CallsStatusResult> => {
  try {
    const raw = await extendedProvider(provider).request({
      method: 'wallet_getCallsStatus',
      params: [batchId],
    })
    return parseCallsStatus(raw)
  } catch (e) {
    const err = e as { message?: string; code?: string | number }
    throw new ERC5792RpcError(
      err.message ?? 'wallet_getCallsStatus failed',
      err.code,
    )
  }
}
