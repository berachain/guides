import ky from 'ky'
import type { Address, Hex } from 'viem'
import type {
  KyberBuildResponse,
  KyberRoutesResponse,
  RouteSummary,
} from '../types/kyberswap'
import { WBERA_ADDRESS } from './berachain'

const KYBER_BASE =
  'https://aggregator-api.kyberswap.com/berachain/api/v1' as const

const client = ky.create({
  baseUrl: `${KYBER_BASE}/`,
  headers: { 'x-client-id': 'bera-batch-swapper' },
  timeout: 30_000,
})

export const fetchKyberRoute = async (params: {
  tokenIn: Address
  amountIn: bigint
  signal?: AbortSignal
}): Promise<RouteSummary | null> => {
  const searchParams = new URLSearchParams({
    tokenIn: params.tokenIn.toLowerCase(),
    tokenOut: WBERA_ADDRESS.toLowerCase(),
    amountIn: params.amountIn.toString(),
    saveGas: 'false',
    gasInclude: 'true',
  })
  const res = await client
    .get('routes', { searchParams, signal: params.signal })
    .json<KyberRoutesResponse>()
  if (res.code !== 0 || !res.data?.routeSummary) {
    return null
  }
  return res.data.routeSummary
}

export const buildKyberCalldata = async (params: {
  routeSummary: RouteSummary
  sender: Address
  recipient: Address
  slippageToleranceBps: number
  deadlineUnix: number
  signal?: AbortSignal
}): Promise<{
  data: Hex
  routerAddress: Address
  amountOut: string
  gas: string
} | null> => {
  const body = {
    routeSummary: params.routeSummary,
    sender: params.sender,
    recipient: params.recipient,
    slippageTolerance: params.slippageToleranceBps,
    deadline: params.deadlineUnix,
  }
  const res = await client
    .post('route/build', { json: body, signal: params.signal })
    .json<KyberBuildResponse>()
  if (res.code !== 0 || !res.data) {
    return null
  }
  return {
    data: res.data.data,
    routerAddress: res.data.routerAddress,
    amountOut: res.data.amountOut,
    gas: res.data.gas,
  }
}

export const computePriceImpactRatio = (summary: RouteSummary): number => {
  const inUsd = Number(summary.amountInUsd)
  const outUsd = Number(summary.amountOutUsd)
  if (!Number.isFinite(inUsd) || inUsd <= 0 || !Number.isFinite(outUsd)) {
    return 0
  }
  return Math.max(0, (inUsd - outUsd) / inUsd)
}
