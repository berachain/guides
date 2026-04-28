import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SCREEN_PADDING } from "@/components/styles";
import { getActiveNetwork, useNetworksStore } from "@/lib/stores/networks";

export default function Settings(): React.JSX.Element {
  const router = useRouter();
  const networks = useNetworksStore((s) => s.networks);
  const activeNetworkId = useNetworksStore((s) => s.activeNetworkId);
  const active = getActiveNetwork(networks, activeNetworkId);

  return (
    <View className={`flex-1 bg-white ${SCREEN_PADDING}`}>
      <View className="gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <Text className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Networks
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push("/(settings)/networks" as never);
          }}
          className="rounded-lg bg-white px-4 py-4 active:bg-neutral-100"
        >
          <Text className="text-base font-semibold text-neutral-900">
            Manage networks
          </Text>
          <Text className="mt-1 text-sm text-neutral-500">
            {active ? `Active: ${active.name}` : "No network configured"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
