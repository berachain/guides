import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { DeleteNetworkDialog } from "@/components/DeleteNetworkDialog";
import { NetworkForm, type NetworkFormOutput } from "@/components/NetworkForm";
import {
  DESTRUCTIVE_BUTTON,
  DESTRUCTIVE_BUTTON_TEXT,
  SCREEN_PADDING,
} from "@/components/styles";
import { useNetworksStore } from "@/lib/stores/networks";

export default function EditNetwork(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const networks = useNetworksStore((s) => s.networks);
  const updateNetwork = useNetworksStore((s) => s.updateNetwork);
  const deleteNetwork = useNetworksStore((s) => s.deleteNetwork);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const network = networks.find((n) => n.id === id);
  const initialValues = useMemo(
    () =>
      network
        ? {
            name: network.name,
            rpcUrl: network.rpcUrl,
            chainId: String(network.chainId),
            currencySymbol: network.currencySymbol,
            blockExplorerUrl: network.blockExplorerUrl ?? "",
          }
        : undefined,
    [network],
  );

  if (!network || !initialValues) {
    return (
      <View
        className={`flex-1 items-center justify-center bg-white ${SCREEN_PADDING}`}
      >
        <Text className="text-base text-neutral-500">Network not found.</Text>
      </View>
    );
  }

  const submit = (input: NetworkFormOutput): void => {
    try {
      updateNetwork(network.id, input);
      router.replace("/(settings)/networks" as never);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Could not save network", message);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Edit Network" }} />
      <NetworkForm
        initialValues={initialValues}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => router.back()}
      />
      <View className={`${SCREEN_PADDING} pt-0`}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDeleteDialogVisible(true);
          }}
          className={DESTRUCTIVE_BUTTON}
        >
          <Text className={DESTRUCTIVE_BUTTON_TEXT}>Delete network</Text>
        </Pressable>
      </View>
      <DeleteNetworkDialog
        network={deleteDialogVisible ? network : null}
        onCancel={() => setDeleteDialogVisible(false)}
        onConfirm={(target) => {
          deleteNetwork(target.id);
          setDeleteDialogVisible(false);
          router.replace("/(settings)/networks" as never);
        }}
      />
    </>
  );
}
