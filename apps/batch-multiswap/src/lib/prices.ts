import ky from 'ky'
import type { Address } from 'viem'

const COINGECKO_TOKEN =
  'https://api.coingecko.com/api/v3/simple/token_price/berachain' as const

export const fetchTokenUsdPrices = async (params: {
  addresses: readonly Address[]
  signal?: AbortSignal
}): Promise<Record<string, number>> => {
  if (params.addresses.length === 0) {
    return {}
  }
  const q = params.addresses.map((a) => a.toLowerCase()).join(',')
  try {
    const data = await ky(COINGECKO_TOKEN, {
      searchParams: { contract_addresses: q, vs_currencies: 'usd' },
      timeout: 15_000,
      signal: params.signal,
    }).json<Record<string, { usd?: number } | undefined>>()
    const out: Record<string, number> = {}
    for (const [addr, row] of Object.entries(data)) {
      const p = row?.usd
      if (typeof p === 'number' && Number.isFinite(p)) {
        out[addr.toLowerCase()] = p
      }
    }
    return out
  } catch {
    return {}
  }
}
