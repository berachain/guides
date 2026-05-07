import ky from 'ky'
import { getAddress, isAddress } from 'viem'
import type { Token } from '../types/token'
import { BERACHAIN_SEED_TOKENS, berachain } from './berachain'

const BERACHAIN_TOKEN_LIST_URL =
  'https://raw.githubusercontent.com/berachain/metadata/main/src/tokens/mainnet.json'

interface BerachainMetadataToken {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  extensions?: {
    coingeckoId?: string
  }
}

interface BerachainMetadataTokenList {
  tokens: BerachainMetadataToken[]
}

const toToken = (token: BerachainMetadataToken): Token | null => {
  if (
    token.chainId !== berachain.id ||
    token.address === '0x0000000000000000000000000000000000000000' ||
    !isAddress(token.address)
  ) {
    return null
  }

  return {
    address: getAddress(token.address),
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoUri: token.logoURI ?? '/vite.svg',
    coingeckoId: token.extensions?.coingeckoId,
  }
}

export const fetchBerachainTokenList = async (
  signal?: AbortSignal,
): Promise<Token[]> => {
  try {
    const list = await ky(BERACHAIN_TOKEN_LIST_URL, {
      signal,
      timeout: 15_000,
    }).json<BerachainMetadataTokenList>()

    const byAddress = new Map<string, Token>()
    for (const token of BERACHAIN_SEED_TOKENS) {
      byAddress.set(token.address.toLowerCase(), token)
    }
    for (const raw of list.tokens) {
      const token = toToken(raw)
      if (token) {
        byAddress.set(token.address.toLowerCase(), token)
      }
    }

    return [...byAddress.values()]
  } catch {
    return [...BERACHAIN_SEED_TOKENS]
  }
}
