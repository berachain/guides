import { type Chain, createPublicClient, defineChain, http, type PublicClient } from 'viem';
import type { Network } from '../types';

export function defineNetworkChain(network: Network): Chain {
  // EVM native currencies overwhelmingly use 18 decimals. Stage 9's network
  // schema does not collect decimals, so Stage 10 assumes 18 until a future
  // network-verification/settings pass makes this configurable.
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: network.currencySymbol,
      symbol: network.currencySymbol,
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [network.rpcUrl] },
    },
  });
}

export function buildPublicClient(network: Network): PublicClient {
  return createPublicClient({
    chain: defineNetworkChain(network),
    transport: http(network.rpcUrl),
  });
}
