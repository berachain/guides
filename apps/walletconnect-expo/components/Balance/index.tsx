// Imports
// ========================================================
import { Text, View } from "react-native";
import { useAccount, useBalance } from "wagmi";

// Component
// ========================================================
export default function Balance() {
  // Hooks
  const { isConnected, address } = useAccount();
  const { data, isError, isLoading } = useBalance({
    address,
  });

  // Return
  /**
   * If still loading, show a loading state
   */
  if (isLoading) return <Text className="Text">Fetching balance...</Text>;

  /**
   * Show error if having a problem fetching the balance
   */
  if (isError) return <Text className="mText">Error fetching balance</Text>;

  /**
   * If not connected don't show anything
   */
  if (!isConnected) return null;

  /**
   * Successfully connected
   */
  return (
    <View className="Balance">
      <Text className="Text">Balance</Text>
      <Text className="Code">
        {(
          parseInt((data?.value ?? "").toString()) / 1000000000000000000
        ).toFixed(2)}{" "}
        $BERA
      </Text>
    </View>
  );
}
