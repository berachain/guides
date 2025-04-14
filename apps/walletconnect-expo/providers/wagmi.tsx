// Imports
// ========================================================
import "@walletconnect/react-native-compat";
import {
  createWeb3Modal,
  defaultWagmiConfig,
} from "@web3modal/wagmi-react-native";
import { defineChain } from "viem";
import { WagmiConfig } from "wagmi";

// Config
// ========================================================
// 1. Get projectId at https://cloud.walletconnect.com
const projectId = `${process.env.EXPO_PUBLIC_WALLET_CONNECT_PROJECT_ID}`;

if (!projectId)
  throw Error("Error: Missing `EXPO_PUBLIC_WALLET_CONNECT_PROJECT_ID`.");

// 2. Create config for our app - defined by our env vars
const metadata = {
  name: `${process.env.EXPO_PUBLIC_METADATA_NAME}`,
  description: `${process.env.EXPO_PUBLIC_METADATA_DESCRIPTION}`,
  url: `${process.env.EXPO_PUBLIC_METADATA_URL}`,
  icons: [`${process.env.EXPO_PUBLIC_METADATA_ICONS}`],
  redirect: {
    native: `${process.env.EXPO_PUBLIC_METADATA_REDIRECT_NATIVE}`,
    universal: `${process.env.EXPO_PUBLIC_METADATA_REDIRECT_UNIVERSAL}`,
  },
};

// 3. Configure our custom chain - Note this is needed for wagmi and viem v1
/**
 * @dev Custom chain configuration
 */
const chainConfiguration = defineChain({
  id: parseInt(`${process.env.EXPO_PUBLIC_CHAIN_ID}`),
  name: `${process.env.EXPO_PUBLIC_CHAIN_NAME}`,
  network: `${process.env.EXPO_PUBLIC_CHAIN_NETWORK}`,
  nativeCurrency: {
    decimals: parseInt(
      `${process.env.EXPO_PUBLIC_CHAIN_NATIVECURRENCY_DECIMALS}`,
    ),
    name: `${process.env.EXPO_PUBLIC_CHAIN_NATIVECURRENCY_NAME}`,
    symbol: `${process.env.EXPO_PUBLIC_CHAIN_NATIVECURRENCY_SYMBOL}`,
  },
  rpcUrls: {
    default: {
      http: [`${process.env.EXPO_PUBLIC_CHAIN_RPC_URL}`],
    },
    public: {
      http: [`${process.env.EXPO_PUBLIC_CHAIN_RPC_URL}`],
    },
  },
  blockExplorers: {
    default: {
      name: `${process.env.EXPO_PUBLIC_CHAIN_BLOCKEXPLORER_NAME}`,
      url: `${process.env.EXPO_PUBLIC_CHAIN_BLOCKEXPLORER_URL}`,
    },
  },
});

/**
 * @dev supported chains
 */
const chains = [chainConfiguration];

/**
 *
 */
const wagmiConfig = defaultWagmiConfig({ chains, projectId, metadata });

// 4. Create modal configuration
createWeb3Modal({
  projectId,
  chains,
  wagmiConfig,
});

// Provider
// ========================================================
export default function Wagmi({ children }: { children: React.ReactNode }) {
  return <WagmiConfig config={wagmiConfig}>{children}</WagmiConfig>;
}
