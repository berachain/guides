import { Stack, useRouter } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";
import { useNetworksStore } from "@/lib/stores/networks";
import { useWalletsStore } from "@/lib/stores/wallets";

export default function WalletsLayout(): React.JSX.Element {
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#ffffff" },
        headerShadowVisible: false,
        headerTitleAlign: "center",
        contentStyle: { backgroundColor: "#ffffff" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Wallets",
          headerBackVisible: false,
          headerTitle: () => <HeaderTitle />,
          headerRight: () => (
            <View className="flex-row items-center gap-4">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                hitSlop={12}
                onPress={() => {
                  router.push("/(settings)" as never);
                }}
              >
                <Text className="text-xl text-neutral-900">⚙</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New wallet"
                hitSlop={12}
                onPress={() => {
                  router.push("/(onboarding)/generate");
                }}
              >
                <Text className="text-3xl font-light text-neutral-900">+</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <Stack.Screen name="[id]" options={{ title: "Wallet" }} />
    </Stack>
  );
}

/**
 * Header title with a dev-only long-press to wipe all persisted wallets.
 * Gated by `__DEV__` so the destructive path doesn't ship in production.
 */
function HeaderTitle(): React.JSX.Element {
  const resetAll = useWalletsStore((s) => s.resetAll);
  const resetNetworks = useNetworksStore((s) => s.resetAll);

  const handleLongPress = (): void => {
    if (!__DEV__) return;
    Alert.alert(
      "Reset all wallets (DEV)",
      "Wipes MMKV index and deletes every Keychain entry. Not reversible.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            void resetAll();
            resetNetworks();
          },
        },
      ],
    );
  };

  return (
    <Pressable delayLongPress={2000} onLongPress={handleLongPress} hitSlop={8}>
      <Text className="text-base font-semibold text-neutral-900">Wallets</Text>
    </Pressable>
  );
}
