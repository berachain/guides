// Add window.ethereum type declaration
declare global {
  interface Window {
    ethereum?: any;
  }
}

import {
  createPublicClient,
  http,
  createWalletClient,
  custom,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { berachainMainnet, berachainBepolia, type Chain } from "./index";

/**
 * Create a viem public client for Berachain
 */
export function createBerachainPublicClient(
  chain: Chain = berachainMainnet
): PublicClient {
  return createPublicClient({
    chain,
    transport: http(),
  });
}

/**
 * Create a viem wallet client for Berachain with a private key
 * @param privateKey - The private key to use
 * @param chain - The chain to use (defaults to mainnet)
 * @param transport - Optional transport to use (defaults to http)
 */
export function createBerachainWalletClient(
  privateKey: `0x${string}`,
  chain: Chain = berachainMainnet,
  transport: Transport = http()
): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain,
    transport,
  });
}

/**
 * Create a browser-based viem wallet client for Berachain
 * Only use this in browser environments
 * @param account - Optional account to use (if not provided, will use the first account from window.ethereum)
 */
export function createBrowserWalletClient(
  chain: Chain = berachainMainnet,
  account?: Account
): WalletClient {
  if (typeof window === "undefined") {
    throw new Error(
      "Browser wallet client can only be created in browser environment"
    );
  }
  if (!window.ethereum) {
    throw new Error("No ethereum provider found in window");
  }
  return createWalletClient({
    account,
    chain,
    transport: custom(window.ethereum),
  });
}
