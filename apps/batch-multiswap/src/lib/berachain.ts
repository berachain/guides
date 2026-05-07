import { defineChain, numberToHex } from 'viem'
import type { Address } from 'viem'
import type { Token } from '../types/token'

export const berachain = defineChain({
  id: 80094,
  name: 'Berachain',
  nativeCurrency: { decimals: 18, name: 'BERA', symbol: 'BERA' },
  rpcUrls: {
    default: { http: ['https://rpc.berachain.com'] },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
  blockExplorers: {
    default: { name: 'BeraScan', url: 'https://berascan.com' },
  },
})

/** Hex chain id for ERC-5792 RPC params (80094 → 0x138de). */
export const BERACHAIN_CHAIN_ID_HEX = numberToHex(berachain.id)

/**
 * Kyber Berachain routes use WBERA as tokenOut (native 0x00 is not accepted by the API).
 * Docs: https://docs.berachain.com/build/getting-started/deployed-contracts
 */
export const WBERA_ADDRESS =
  '0x6969696969696969696969696969696969696969' as Address

/** Marker for native BERA in product copy; Kyber uses WBERA for routing. */
export const BERA_NATIVE_ZERO =
  '0x0000000000000000000000000000000000000000' as Address

export const MULTICALL3_ADDRESS =
  '0xcA11bde05977b3631167028862bE2a173976CA11' as Address

/**
 * Curated Berachain mainnet tokens. Addresses from Berachain docs / explorers;
 * verify on https://berascan.com before mainnet use.
 */
export const BERACHAIN_SEED_TOKENS: readonly Token[] = [
  {
    address: '0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce',
    symbol: 'HONEY',
    name: 'Honey',
    decimals: 18,
    logoUri:
      'https://assets.coingecko.com/coins/images/33624/small/honey.png',
    coingeckoId: 'honey-3',
  },
  {
    address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c',
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
    logoUri:
      'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
    coingeckoId: 'wrapped-bitcoin',
  },
  {
    address: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    logoUri:
      'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    coingeckoId: 'ethereum',
  },
  {
    address: '0x549943e04f40284185054145c6E4e9568C1D3241',
    symbol: 'USDC.e',
    name: 'Bridged USDC',
    decimals: 6,
    logoUri:
      'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    coingeckoId: 'usd-coin',
  },
  {
    address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    symbol: 'USDT',
    name: 'USDT0',
    decimals: 6,
    logoUri:
      'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    coingeckoId: 'tether',
  },
  {
    address: '0x118D2cEeE9785eaf70C15Cd74CD84c9f8c3EeC9a',
    symbol: 'sWBERA',
    name: 'WBERA Staker Vault',
    decimals: 18,
    logoUri:
      'https://assets.coingecko.com/coins/images/34285/small/berachain.jpeg',
    coingeckoId: 'berachain-bera',
  },
  {
    address: '0xac03cABA51e17c86c921e1f6CBFbDC91F8Bb2e6b',
    symbol: 'iBGT',
    name: 'Infrared BGT',
    decimals: 18,
    logoUri:
      'https://assets.coingecko.com/coins/images/54321/small/ibgt.png',
    coingeckoId: 'infrared-bgt',
  },
  {
    address: '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba',
    symbol: 'BGT',
    name: 'Bera Governance Token',
    decimals: 18,
    logoUri:
      'https://assets.coingecko.com/coins/images/34285/small/berachain.jpeg',
    coingeckoId: 'berachain-governance-token',
  },
] as const
