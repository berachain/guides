import { useCallback } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useWalletsStore } from "@/lib/stores/wallets";

/**
 * Persistent advisory banner shown at the top of the app whenever
 * `runSecurityChecks` flagged the device. Not dismissible — the only way
 * to clear it is to remediate the underlying condition and relaunch.
 */
export function SecurityWarningBanner(): React.JSX.Element | null {
  const warning = useWalletsStore((s) => s.securityWarning);

  const onPress = useCallback((): void => {
    if (warning === null) return;
    const details: string[] = [];
    if (warning.jailbroken) details.push("• Jailbreak indicators detected");
    if (warning.debugged) details.push("• Running under a debugger");
    if (warning.hooked) details.push("• Runtime hooking framework detected");
    Alert.alert(
      "Device security warning",
      `${details.join("\n")}\n\nJailbreak detection uses heuristics and can be bypassed by determined attackers. Treat this as an advisory, not a security boundary.`,
    );
  }, [warning]);

  if (warning === null) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Device security warning"
      onPress={onPress}
      className="bg-red-600 px-4 py-2"
    >
      <Text className="text-sm font-medium text-white">
        This device appears to be jailbroken or modified. Storing significant
        value on this device is not recommended.
      </Text>
    </Pressable>
  );
}
