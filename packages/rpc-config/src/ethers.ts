import { JsonRpcProvider, BrowserProvider } from "ethers";
import { berachainMainnet, type Chain } from "./index";

/**
 * Create an ethers provider for Berachain
 */
export function createBerachainProvider(
  chain: Chain = berachainMainnet,
): JsonRpcProvider {
  return new JsonRpcProvider(chain.rpcUrls.default.http[0]);
}

/**
 * Create a browser-based ethers provider for Berachain
 * Only use this in browser environments
 */
export function createBrowserProvider(
  chain: Chain = berachainMainnet,
): BrowserProvider {
  if (typeof window === "undefined") {
    throw new Error(
      "Browser provider can only be created in browser environment",
    );
  }
  if (!window.ethereum) {
    throw new Error("No ethereum provider found in window");
  }
  return new BrowserProvider(window.ethereum);
}
