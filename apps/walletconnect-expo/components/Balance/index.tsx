// Imports
// ========================================================
import { Text } from "react-native";
import { useAccount, useBalance } from "wagmi";
import { styles } from "../../App";

// Component
// ========================================================
export default function BlockNumber() {
  // Hooks
  const { isConnected } = useAccount();
  const { data, isError, isLoading } = useBalance();

  // Return
  if (!isConnected) return null;

  if (isLoading)
    return <Text style={{ marginBottom: 24 }}>Fetching balance...</Text>;

  if (isError)
    return (
      <Text style={{ marginBottom: 24 }}>Error fetching balance</Text>
    );

  return (
    <>
      <Text>$BERA Balance</Text>
      <Text>{data?.toString()}</Text>
    </>
  );
}