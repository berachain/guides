import type { GetSupportedExecutionPermissionsResult } from '@/types/erc7715'
import type { EIP1193Provider } from 'viem'

async function requestWalletMethod<T>(
  provider: EIP1193Provider,
  method: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const request = provider.request as (args: {
    method: string
    params?: readonly unknown[]
  }) => Promise<T>
  return request({ method, params })
}

// TODO: Phase 3 — optional shared helpers for revoke / redeem RPCs (request flow lives in hooks/useRequestPermissions.ts).

export type FetchSupportedExecutionPermissionsResult =
  | { status: 'ok'; data: GetSupportedExecutionPermissionsResult; raw: unknown }
  | { status: 'unsupported' }
  | { status: 'error'; errorCode?: number; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSupportedShape(
  value: unknown,
): value is GetSupportedExecutionPermissionsResult {
  if (!isRecord(value)) return false
  for (const entry of Object.values(value)) {
    if (!isRecord(entry)) return false
    const { chainIds, ruleTypes } = entry
    if (!Array.isArray(chainIds) || !Array.isArray(ruleTypes)) return false
    if (!chainIds.every((id) => typeof id === 'string')) return false
    if (!ruleTypes.every((t) => typeof t === 'string')) return false
  }
  return true
}

function readRpcCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined
  const { code } = error
  return typeof code === 'number' ? code : undefined
}

/**
 * Calls `wallet_getSupportedExecutionPermissions` on `window.ethereum` (MetaMask / Flask).
 */
export async function fetchWalletSupportedExecutionPermissions(): Promise<FetchSupportedExecutionPermissionsResult> {
  if (typeof window === 'undefined') {
    return { status: 'error', message: 'Wallet is only available in the browser' }
  }

  const provider = window.ethereum
  if (!provider?.request) {
    return { status: 'error', message: 'No EIP-1193 provider on window.ethereum' }
  }

  try {
    const raw = await requestWalletMethod<unknown>(provider, 'wallet_getSupportedExecutionPermissions', [])

    if (!isSupportedShape(raw)) {
      return {
        status: 'error',
        message: 'Wallet returned an unexpected shape for supported execution permissions',
      }
    }

    return { status: 'ok', data: raw, raw }
  } catch (error: unknown) {
    const code = readRpcCode(error)
    if (code === -32601) {
      return { status: 'unsupported' }
    }

    const message =
      error instanceof Error
        ? error.message
        : isRecord(error) && typeof error.message === 'string'
          ? error.message
          : 'Unknown wallet error'

    return { status: 'error', errorCode: code, message }
  }
}
