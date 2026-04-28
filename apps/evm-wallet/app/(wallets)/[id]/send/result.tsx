import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "@/components/styles";
import { buildExplorerTxUrl } from "@/lib/blockExplorer";
import { useNetworksStore } from "@/lib/stores/networks";
import { useSendStore } from "@/lib/stores/send";

export default function SendResultScreen(): React.JSX.Element {
  const { id, hash, networkId } = useLocalSearchParams<{
    id: string;
    hash: string;
    networkId: string;
  }>();
  const router = useRouter();
  const clearDraft = useSendStore((s) => s.clearDraft);
  const network = useNetworksStore((s) =>
    s.networks.find((item) => item.id === networkId),
  );
  const txHash = Array.isArray(hash) ? hash[0] : hash;
  const explorerUrl =
    network?.blockExplorerUrl && txHash
      ? buildExplorerTxUrl(network.blockExplorerUrl, txHash)
      : null;

  const handleCopy = async (): Promise<void> => {
    if (!txHash) return;
    await Clipboard.setStringAsync(txHash);
    Alert.alert("Transaction hash copied", txHash);
  };

  const handleDone = (): void => {
    clearDraft();
    router.replace({
      pathname: "/(wallets)/[id]",
      params: { id: id ?? "" },
    } as never);
  };

  return (
    <View className={`flex-1 bg-white ${SCREEN_PADDING}`}>
      <Stack.Screen
        options={{ title: "Transaction sent", headerBackVisible: false }}
      />
      <View className="flex-1 justify-center gap-6">
        <View className="items-center">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <Text className="text-5xl text-green-700">✓</Text>
          </View>
          <Text className="mt-6 text-2xl font-semibold text-neutral-900">
            Transaction sent
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-neutral-600">
            Your transaction has been broadcast to the network.
          </Text>
        </View>

        <View className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Transaction hash
          </Text>
          <View className="mt-3 flex-row items-center gap-3">
            <Text className="flex-1 font-mono text-sm text-neutral-900">
              {txHash ? truncateHash(txHash) : "Unavailable"}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={!txHash}
              onPress={() => {
                void handleCopy();
              }}
              className="rounded-md border border-neutral-300 px-3 py-2 active:bg-neutral-100"
            >
              <Text className="text-xs font-medium text-neutral-700">Copy</Text>
            </Pressable>
          </View>
        </View>

        <View className="gap-3">
          {explorerUrl ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void Linking.openURL(explorerUrl);
              }}
              className={SECONDARY_BUTTON}
            >
              <Text className={SECONDARY_BUTTON_TEXT}>
                View on block explorer
              </Text>
            </Pressable>
          ) : (
            <Text className="text-center text-sm text-neutral-500">
              Configure a block explorer URL on this network to enable
              transaction tracking.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={handleDone}
            className={PRIMARY_BUTTON}
          >
            <Text className={PRIMARY_BUTTON_TEXT}>Done</Text>
          </Pressable>
        </View>

        <Text className="text-center text-xs leading-5 text-neutral-500">
          It may take a few minutes for your transaction to confirm. The network
          fee has been deducted whether or not the transaction succeeds.
        </Text>
      </View>
    </View>
  );
}

function truncateHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}
