// Imports
// ========================================================
import { W3mButton } from "@web3modal/wagmi-react-native";
import { View } from "react-native";

// Component
// ========================================================
export default function Connect() {
  return (
    <>
      <View className="bg-white rounded-full mb-4">
        <W3mButton connectStyle={
          {
            backgroundColor: '#2E1E1A',
          }
        } accountStyle={{
          backgroundColor: '#2E1E1A',
        }} />
      </View>
    </>
  );
}
