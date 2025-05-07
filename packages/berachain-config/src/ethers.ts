import { ethers } from 'ethers';
import { berachainMainnet, berachainBepolia, type Chain } from './index';

/**
 * Create an ethers provider for Berachain
 * @param chain - The chain to use (defaults to mainnet)
 * @param options - Additional provider options
 */
export function createBerachainEthersProvider(
  chain: Chain = berachainMainnet,
  options?: ethers.JsonRpcProviderOptions
): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0], undefined, options);
}

/**
 * Create an ethers signer for Berachain
 * @param privateKey - The private key to use
 * @param chain - The chain to use (defaults to mainnet)
 */
export function createBerachainEthersSigner(
  privateKey: string,
  chain: Chain = berachainMainnet
): ethers.Wallet {
  const provider = createBerachainEthersProvider(chain);
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Create a browser-based ethers signer for Berachain
 * Only use this in browser environments
 */
export function createBrowserEthersSigner(chain: Chain = berachainMainnet): ethers.BrowserProvider {
  if (typeof window === 'undefined') {
    throw new Error('Browser signer can only be created in browser environment');
  }
  return new ethers.BrowserProvider(window.ethereum);
} 