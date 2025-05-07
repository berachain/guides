import { createPublicClient, http, createWalletClient, custom, type PublicClient, type WalletClient, type Transport } from 'viem';
import { berachainMainnet, berachainBepolia, type Chain } from './index';

/**
 * Create a viem public client for Berachain
 */
export function createBerachainPublicClient(chain: Chain = berachainMainnet): PublicClient {
  return createPublicClient({
    chain,
    transport: http()
  });
}

/**
 * Create a viem wallet client for Berachain
 * @param transport - The transport to use (http for Node.js, custom for browser)
 * @param chain - The chain to use (defaults to mainnet)
 */
export function createBerachainWalletClient(
  transport: Transport = http(),
  chain: Chain = berachainMainnet
): WalletClient {
  return createWalletClient({
    chain,
    transport
  });
}

/**
 * Create a browser-based viem wallet client for Berachain
 * Only use this in browser environments
 */
export function createBrowserWalletClient(chain: Chain = berachainMainnet): WalletClient {
  if (typeof window === 'undefined') {
    throw new Error('Browser wallet client can only be created in browser environment');
  }
  return createWalletClient({
    chain,
    transport: custom(window.ethereum)
  });
} 