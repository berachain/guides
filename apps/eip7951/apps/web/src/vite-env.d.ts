/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ETHEREUM_MAINNET_RPC_URL: string;
  readonly VITE_ETHEREUM_SEPOLIA_RPC_URL: string;
  readonly VITE_BERACHAIN_MAINNET_RPC_URL: string;
  readonly VITE_BERACHAIN_BEPOLIA_RPC_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: {
    request: (args: {
      method: string;
      params?: unknown[] | object;
    }) => Promise<unknown>;
  };
}
