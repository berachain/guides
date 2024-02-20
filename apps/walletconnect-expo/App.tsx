// Imports
// ========================================================
import "@walletconnect/react-native-compat";
import { WagmiConfig } from "wagmi";
import {  } from "viem/chains";
import {
  createWeb3Modal,
  defaultWagmiConfig,
  Web3Modal,
} from "@web3modal/wagmi-react-native";
import { StatusBar } from "expo-status-bar";
import { KeyboardAvoidingView, Text, View } from "react-native";
import { defineChain } from "viem";
import Connect from "./components/Connect";
import Balance from "./components/Balance";
import SignMessage from "./components/SignMessage";
import { Logo } from "./components/Icons";
import Deploy from "./components/Deploy";

// Config
// ========================================================
// 1. Get projectId at https://cloud.walletconnect.com
const projectId = `${process.env.EXPO_PUBLIC_WALLET_CONNECT_PROJECT_ID}`;

if (!projectId) throw Error('Error: Missing `EXPO_PUBLIC_WALLET_CONNECT_PROJECT_ID`.');

// 2. Create config
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

/**
 * @dev Custom chain configuration
 */
const chainConfiguration = defineChain({
	id: process.env.EXPO_PUBLIC_CHAIN_ID,
	name:`${process.env.EXPO_PUBLIC_CHAIN_NAME}`,
	network: `${process.env.EXPO_PUBLIC_CHAIN_NETWORK}`,
	nativeCurrency: {
		decimals: `${process.env.EXPO_PUBLIC_CHAIN_NATIVECURRENCY_DECIMALS}`,
		name: `${process.env.EXPO_PUBLIC_CHAIN_NATIVECURRENCY_NAME}`,
		symbol:`${process.env.EXPO_PUBLIC_CHAIN_NATIVECURRENCY_SYMBOL}`,
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
      url: `${process.env.EXPO_PUBLIC_CHAIN_BLOCKEXPLORER_URL}` 
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

// 3. Create modal
createWeb3Modal({
  projectId,
  chains,
  wagmiConfig,
});

// Main Component
// ========================================================
export default function App() {
  return (
    <WagmiConfig config={wagmiConfig}>
      <View className="flex-1 items-center justify-center bg-[#F47226] text-[#2E1E1A] w-full">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="w-full px-8">
        <Logo className="w-auto h-10 mx-auto" />
        <Text className="text-lg font-semibold mb-2 text-[#121312] text-center">Berachain WalletConnect Expo Example</Text>
        <Text className="text-sm mb-8 text-[#2E1E1A] text-center">Demonstrating how to build mobile dApps</Text>
        
        <StatusBar style="auto" />
        <Web3Modal />
        <Connect />
        <Balance />
        <SignMessage />
        <Deploy />
      </KeyboardAvoidingView>
      </View>
    </WagmiConfig>
  );
}
