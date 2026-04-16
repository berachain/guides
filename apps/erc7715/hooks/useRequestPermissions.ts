'use client'

import { useMutation } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { EIP1193Provider } from 'viem'
import type { PermissionRequest, PermissionResponse } from '@/types/erc7715'

export class ExecutionPermissionsUnsupportedError extends Error {
  readonly code = -32601 as const
  override readonly name = 'ExecutionPermissionsUnsupportedError'
  constructor(message = 'wallet_requestExecutionPermissions is not supported by this wallet') {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ExecutionPermissionsUserRejectedError extends Error {
  readonly code = 4001 as const
  override readonly name = 'ExecutionPermissionsUserRejectedError'
  constructor(message = 'You rejected the request in your wallet') {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

function readRpcCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : undefined
}

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

function isPermissionResponse(value: unknown): value is PermissionResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.context === 'string' &&
    typeof v.delegationManager === 'string' &&
    Array.isArray(v.dependencies)
  )
}

/**
 * Calls `wallet_requestExecutionPermissions` with JSON-RPC `params` set to the `PermissionRequest[]` array (ERC-7715).
 */
export async function submitExecutionPermissionRequests(
  requests: PermissionRequest[],
): Promise<PermissionResponse[]> {
  if (typeof window === 'undefined') {
    throw new Error('Wallet is only available in the browser')
  }

  const provider = window.ethereum as EIP1193Provider | undefined
  if (!provider?.request) {
    throw new Error('No EIP-1193 provider on window.ethereum')
  }

  try {
    const params = requests as unknown as readonly unknown[]
    console.log('ERC-7715 request payload', JSON.stringify(params, null, 2))
    const raw = await requestWalletMethod<unknown>(
      provider,
      'wallet_requestExecutionPermissions',
      params,
    )

    if (!Array.isArray(raw)) {
      throw new Error('Wallet returned a non-array response')
    }

    if (!raw.every(isPermissionResponse)) {
      throw new Error('Wallet returned an unexpected permission response shape')
    }

    return raw
  } catch (error: unknown) {
    const code = readRpcCode(error)
    if (code === -32601) {
      throw new ExecutionPermissionsUnsupportedError()
    }
    if (code === 4001) {
      throw new ExecutionPermissionsUserRejectedError()
    }
    throw error
  }
}

export type UseRequestPermissionsReturn = {
  mutate: (requests: PermissionRequest[]) => void
  mutateAsync: (requests: PermissionRequest[]) => Promise<PermissionResponse[]>
  isPending: boolean
  data: PermissionResponse[] | undefined
  error: Error | null
  reset: () => void
  isUnsupported: boolean
  isUserRejected: boolean
}

export function useRequestPermissions(): UseRequestPermissionsReturn {
  const [successData, setSuccessData] = useState<PermissionResponse[] | undefined>()

  const mutation = useMutation<PermissionResponse[], Error, PermissionRequest[]>({
    mutationFn: submitExecutionPermissionRequests,
    onSuccess: (data) => {
      setSuccessData(data)
    },
  })

  const reset = useCallback(() => {
    mutation.reset()
    setSuccessData(undefined)
  }, [mutation])

  const err = mutation.error

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    data: successData,
    error: (err ?? null) as Error | null,
    reset,
    isUnsupported: err instanceof ExecutionPermissionsUnsupportedError,
    isUserRejected: err instanceof ExecutionPermissionsUserRejectedError,
  }
}
