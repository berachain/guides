// Imports
// ========================================================
import { Text } from "react-native";
import { useAccount, useBalance } from "wagmi";

// Component
// ========================================================
export default function BlockNumber() {
  // Hooks
  const { isConnected, address } = useAccount();
  const { data, isError, isLoading } = useBalance({
    address
  });

  // Return
  if (!isConnected) return null;

  if (isLoading)
    return <Text className="mb-4">Fetching balance...</Text>;

  if (isError)
    return (
      <Text className="mb-4">Error fetching balance</Text>
    );

  return (
    <>
      <Text className="text-[#2E1E1A] mb-2">Balance</Text>
      <Text className="bg-[#ff843d] p-2 mb-4">{(parseInt(data?.value.toString()) / 1000000000000000000).toFixed(2)} $BERA</Text>
    </>
  );
}