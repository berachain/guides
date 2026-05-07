/**
 * Permit2 batch swaps can skip ERC-20 approve transactions when the wallet
 * provides a Permit2 signature. This build uses classic approve + swap calls;
 * extend here with typed permit data if you adopt Permit2-only flows.
 */
export type Permit2Placeholder = Record<string, never>
