// Imports
// ========================================================
import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import { cookieStorage, createStorage } from "wagmi";
import { berachainTestnet } from "wagmi/chains";

// Constants
// ========================================================
// Get projectId at https://cloud.walletconnect.com
export const projectId = "1234567890abcdef1234567890abcdef";

const metadata = {
  name: "Berachain Web3Modal",
  description: "Berachain Web3Modal Example",
  url: "https://web3modal.com", // origin must match your domain & subdomain
  icons: ["https://avatars.githubusercontent.com/u/96059542"],
};

if (!projectId) throw new Error("Project ID is not defined");

// Config
// ========================================================
export const config = defaultWagmiConfig({
  chains: [berachainTestnet], // required
  projectId, // required
  metadata, // required
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
  enableWalletConnect: true, // Optional - true by default
  enableInjected: true, // Optional - true by default
  enableEIP6963: true, // Optional - true by default
  enableCoinbase: true, // Optional - true by default
  //   ...wagmiOptions // Optional - Override createConfig parameters
});
