import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { CancelButton } from "@/components/CancelButton";
import { Checkbox } from "@/components/Checkbox";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
  WARNING_CALLOUT,
  WARNING_CALLOUT_TEXT,
} from "@/components/styles";
import { WalletCryptoError } from "@/lib/storage/secure";
import { useWalletsStore } from "@/lib/stores/wallets";

const WARNING_CANCEL_MESSAGE =
  "Your recovery phrase will be permanently discarded and cannot be recovered.";

export default function Warning(): React.JSX.Element {
  const router = useRouter();
  const navigation = useNavigation();
  const commitPendingCreation = useWalletsStore((s) => s.commitPendingCreation);
  const cancelPendingCreation = useWalletsStore((s) => s.cancelPendingCreation);
  const pendingWalletId = useWalletsStore((s) => s.pendingWalletId);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  usePreventRemove(pendingWalletId !== null && !isCommitting, ({ data }) => {
    Alert.alert("Cancel?", WARNING_CANCEL_MESSAGE, [
      { text: "Keep", style: "default" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await cancelPendingCreation();
            navigation.dispatch(data.action);
          })();
        },
      },
    ]);
  });

  const onContinue = useCallback(async (): Promise<void> => {
    setIsCommitting(true);
    try {
      // The Keychain item was already stored as local-only by
      // beginPendingCreation. Commit derives the primary address, which
      // triggers one biometric prompt on physical devices.
      await commitPendingCreation();
      router.replace("/(wallets)");
    } catch (err) {
      if (err instanceof WalletCryptoError && err.code === "USER_CANCELED") {
        Alert.alert(
          "Authentication canceled",
          "Authenticate to finish creating this wallet.",
        );
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Could not save wallet", message);
    } finally {
      setIsCommitting(false);
    }
  }, [commitPendingCreation, router]);

  const canContinue = acknowledged && !isCommitting;

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName={`${SCREEN_PADDING} gap-6`}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <CancelButton confirmMessage={WARNING_CANCEL_MESSAGE} />
          ),
        }}
      />

      <View className={WARNING_CALLOUT}>
        <Text className={WARNING_CALLOUT_TEXT}>
          You chose not to back up your recovery phrase. If you delete this app,
          lose this device, or it gets damaged, your wallet will be lost
          forever.{"\n\n"}There is no password reset, no support line, no
          recovery. The 24 words you wrote down are the only way to restore this
          wallet.
        </Text>
      </View>

      <Checkbox
        checked={acknowledged}
        onToggle={() => {
          setAcknowledged((v) => !v);
        }}
        label="I understand my wallet will be lost if I don't have my recovery phrase"
      />

      <Text className="text-sm leading-5 text-neutral-500">
        When you continue, you may be asked to authenticate once to finish
        creating the wallet and derive its address.
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={!canContinue}
        onPress={() => {
          void onContinue();
        }}
        className={canContinue ? PRIMARY_BUTTON : PRIMARY_BUTTON_DISABLED}
      >
        {isCommitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className={PRIMARY_BUTTON_TEXT}>I understand, continue</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
