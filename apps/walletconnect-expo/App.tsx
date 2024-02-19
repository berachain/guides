import '@walletconnect/react-native-compat'
import { configureChains, type Chain, Connector } from 'wagmi';
import { publicProvider } from 'wagmi/providers/public';
import { WagmiConfig, createConfig } from 'wagmi'
import { mainnet, polygon, arbitrum } from 'viem/chains'
import { createWeb3Modal, defaultWagmiConfig, Web3Modal } from '@web3modal/wagmi-react-native'
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// 1. Get projectId at https://cloud.walletconnect.com
const projectId = `${process.env.EXPO_PUBLIC_PROJECT_ID}`

// 2. Create config
const metadata = {
  name: 'Web3Modal RN',
  description: 'Web3Modal RN Example',
  url: 'https://web3modal.com',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
  redirect: {
    native: 'YOUR_APP_SCHEME://',
    universal: 'YOUR_APP_UNIVERSAL_LINK.com'
  }
}

const chains = [mainnet, polygon, arbitrum];

// Wallet Connect Start
// ========================================================
const wagmiConfig = defaultWagmiConfig({ chains, projectId, metadata });

// 3. Create modal
createWeb3Modal({
  projectId,
  chains,
  wagmiConfig
});

export default function App() {
  return (
    <WagmiConfig config={wagmiConfig}>
      <View style={styles.container}>
        <Text>Open up App.tsx to start working on your app!</Text>
        <Text>Huh {process.env.EXPO_PUBLIC_TEST}</Text>
        <StatusBar style="auto" />
        <Web3Modal />
      </View>
    </WagmiConfig>
  );
}
// ========================================================
// END - Wallet Connect

// Just Wagmi Start (Working without Wallet Connect)
// ========================================================
// const { publicClient } = configureChains(chains, [
//   // walletConnectProvider({ projectId }),
//   publicProvider()
// ]);

// const wagmiConfig = createConfig({
//   autoConnect: true,
//   connectors: [],
//   publicClient
// })

// export default function App() {
//   return (
//     <WagmiConfig config={wagmiConfig}>
//       <View style={styles.container}>
//         <Text>Open up App.tsx to start working on your app!</Text>
//         <Text>Huh {process.env.EXPO_PUBLIC_TEST}</Text>
//         <StatusBar style="auto" />
//       </View>
//     </WagmiConfig>
//   );
// }
// ========================================================
// End Just Wagmi

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
