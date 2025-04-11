// Imports
// ========================================================
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import "../global.css";
import { Logo } from "../components/Icons";
import Connect from "../components/Connect";
import Balance from "../components/Balance";
import SignMessage from "../components/SignMessage";
import Deploy from "../components/Deploy";
import RootProvider from "../providers";
import { Web3Modal } from "@web3modal/wagmi-react-native";

// Main App Component
// ========================================================
export default function App() {
  return (
    <RootProvider>
      <View className="App">
        <StatusBar style="auto" />
        <Web3Modal />
        <Logo className="w-auto h-10 mx-auto" />
        <Text className="H1">Berachain WalletConnect Expo Example</Text>
        <Text className="Text">Demonstrating how to build mobile dApps</Text>
        <Connect />
        <Balance />
        <SignMessage />
        <Deploy />
      </View>
    </RootProvider>
  );
}
