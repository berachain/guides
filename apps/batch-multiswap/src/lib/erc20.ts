import {
  type Address,
  type Hex,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
} from 'viem'

export const encodeErc20Approve = (params: {
  spender: Address
  amount: bigint
}): Hex => {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [params.spender, params.amount],
  })
}

/** Encode approve for the maximum uint256 (fewer revokes when routers change). */
export const encodeErc20ApproveMax = (spender: Address): Hex => {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  })
}

export const erc20BalanceOfCall = (params: {
  token: Address
  owner: Address
}) =>
  ({
    address: params.token,
    abi: erc20Abi,
    functionName: 'balanceOf' as const,
    args: [params.owner],
  }) as const

export const erc20AllowanceCall = (params: {
  token: Address
  owner: Address
  spender: Address
}) =>
  ({
    address: params.token,
    abi: erc20Abi,
    functionName: 'allowance' as const,
    args: [params.owner, params.spender],
  }) as const
