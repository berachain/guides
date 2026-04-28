import { useCallback } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isRunningOnSimulator } from "@/lib/storage/secure";

export function SimulatorModeBanner(): React.JSX.Element | null {
  const runningOnSimulator = isRunningOnSimulator();
  const insets = useSafeAreaInsets();

  const onPress = useCallback((): void => {
    Alert.alert(
      "Simulator mode",
      "Simulator wallets use plaintext Keychain storage without Secure Enclave or biometric/passcode protection. Transaction signing can proceed without authentication. Use a physical iPhone to validate wallet security.",
    );
  }, []);

  if (!runningOnSimulator) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Simulator mode security notice"
      onPress={onPress}
      style={{ paddingTop: insets.top + 6 }}
      className="bg-amber-400 px-4 pb-2"
    >
      <Text className="text-center text-sm font-semibold text-amber-950">
        Simulator mode: no Secure Enclave or biometric protection.
      </Text>
    </Pressable>
  );
}
