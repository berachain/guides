import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { DeleteNetworkDialog } from "@/components/DeleteNetworkDialog";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
} from "@/components/styles";
import { useNetworksStore } from "@/lib/stores/networks";
import type { Network } from "@/lib/types";

export default function NetworksList(): React.JSX.Element {
  const router = useRouter();
  const networks = useNetworksStore((s) => s.networks);
  const activeNetworkId = useNetworksStore((s) => s.activeNetworkId);
  const setActiveNetwork = useNetworksStore((s) => s.setActiveNetwork);
  const deleteNetwork = useNetworksStore((s) => s.deleteNetwork);
  const [deleteTarget, setDeleteTarget] = useState<Network | null>(null);

  const openNetworkMenu = useCallback(
    (network: Network): void => {
      Alert.alert(
        network.name,
        `Chain ID ${network.chainId} · ${network.currencySymbol}`,
        [
          {
            text: "Edit",
            onPress: () =>
              router.push({
                pathname: "/(settings)/networks/[id]",
                params: { id: network.id },
              } as never),
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => setDeleteTarget(network),
          },
          { text: "Cancel", style: "cancel" },
        ],
      );
    },
    [router],
  );

  const renderItem = ({ item }: { item: Network }): React.JSX.Element => {
    const active = item.id === activeNetworkId;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setActiveNetwork(item.id);
        }}
        onLongPress={() => openNetworkMenu(item)}
        className="flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 active:bg-neutral-100"
      >
        <Text className="mr-3 text-lg text-neutral-900">
          {active ? "●" : "○"}
        </Text>
        <View className="flex-1">
          <Text className="text-base font-semibold text-neutral-900">
            {item.name}
          </Text>
          <Text className="mt-1 text-sm text-neutral-500">
            Chain ID {item.chainId} · {item.currencySymbol}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${item.name}`}
          onPress={() => openNetworkMenu(item)}
          className="rounded-md px-2 py-1 active:bg-neutral-200"
        >
          <Text className="text-lg text-neutral-700">...</Text>
        </Pressable>
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-white">
      <Stack.Screen
        options={{
          title: "Networks",
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to wallets"
              hitSlop={12}
              onPress={() => router.replace("/(wallets)" as never)}
            >
              <Text className="text-base font-medium text-neutral-900">
                Done
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add network"
              hitSlop={12}
              onPress={() => router.push("/(settings)/networks/new" as never)}
            >
              <Text className="text-3xl font-light text-neutral-900">+</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={networks}
        keyExtractor={(network) => network.id}
        renderItem={renderItem}
        contentContainerClassName={`${SCREEN_PADDING} gap-3`}
        ListEmptyComponent={
          <View className="items-center gap-4 py-24">
            <Text className="text-base text-neutral-500">
              No networks configured
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(settings)/networks/new" as never)}
              className={PRIMARY_BUTTON}
            >
              <Text className={PRIMARY_BUTTON_TEXT}>Add a network</Text>
            </Pressable>
          </View>
        }
      />
      <DeleteNetworkDialog
        network={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(network) => {
          deleteNetwork(network.id);
          setDeleteTarget(null);
        }}
      />
    </View>
  );
}
