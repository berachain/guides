import { type Account, createWalletClient, http, type WalletClient } from 'viem';
import { defineNetworkChain } from '@/lib/rpc/client';
import type { Network } from '@/lib/types';

export function buildWalletClient(network: Network, account: Account): WalletClient {
  return createWalletClient({
    account,
    chain: defineNetworkChain(network),
    transport: http(network.rpcUrl),
  });
}
