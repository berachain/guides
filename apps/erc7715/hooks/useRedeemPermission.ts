'use client'

import { useCallback, useState } from 'react'
import { encodeFunctionData, encodePacked, erc20Abi } from 'viem'
import { useWriteContract } from 'wagmi'
import type { PermissionResponse } from '@/types/erc7715'

const REDEEM_DELEGATIONS_ABI = [
  {
    name: 'redeemDelegations',
    type: 'function',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallData', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const EXECUTION_MODE_DEFAULT =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

export type RedeemParams =
  | {
      kind: 'native'
      response: PermissionResponse
      recipient: `0x${string}`
      value: bigint
    }
  | {
      kind: 'erc20'
      response: PermissionResponse
      tokenAddress: `0x${string}`
      recipient: `0x${string}`
      amount: bigint
    }

export function useRedeemPermission() {
  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset: writeReset,
  } = useWriteContract()

  const [localError, setLocalError] = useState<Error | null>(null)

  const mutate = useCallback(
    (params: RedeemParams) => {
      setLocalError(null)
      writeReset()

      if (params.response.dependencies.length > 0) {
        setLocalError(
          new Error(
            `Cannot redeem: ${params.response.dependencies.length} undeployed dependencies. Deploy them before redeeming.`,
          ),
        )
        return
      }

      let executionCallData: `0x${string}`

      if (params.kind === 'erc20') {
        const transferCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [params.recipient, params.amount],
        })
        executionCallData = encodePacked(
          ['address', 'uint256', 'bytes'],
          [params.tokenAddress, BigInt(0), transferCalldata],
        )
      } else {
        executionCallData = encodePacked(
          ['address', 'uint256', 'bytes'],
          [params.recipient, params.value, '0x'],
        )
      }

      writeContract({
        address: params.response.delegationManager,
        abi: REDEEM_DELEGATIONS_ABI,
        functionName: 'redeemDelegations',
        args: [[params.response.context], [EXECUTION_MODE_DEFAULT], [executionCallData]],
      })
    },
    [writeContract, writeReset],
  )

  const reset = useCallback(() => {
    setLocalError(null)
    writeReset()
  }, [writeReset])

  return {
    mutate,
    isPending,
    hash,
    error: localError ?? writeError ?? null,
    reset,
  }
}
