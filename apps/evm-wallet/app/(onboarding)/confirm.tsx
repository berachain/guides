import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { CancelButton } from "@/components/CancelButton";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
} from "@/components/styles";
import { setSyncStateAndDeriveAddress } from "@/lib/crypto/orchestration";
import { WalletCryptoError } from "@/lib/storage/secure";
import { useWalletsStore } from "@/lib/stores/wallets";

/**
 * `App-Prefs:` deep links are undocumented and frequently silently broken
 * between iOS versions. If the URL fails to open we fall back to showing the
 * path as plain text, so the user still knows where to look.
 */
const ICLOUD_KEYCHAIN_SETTINGS_URL = "App-Prefs:CASTLE";

const ICLOUD_MIGRATION_PROMPT = "Authenticate to create your wallet";

export default function Confirm(): React.JSX.Element {
  const router = useRouter();
  const navigation = useNavigation();
  const pendingWalletId = useWalletsStore((s) => s.pendingWalletId);
  const pendingIcloudOptIn = useWalletsStore((s) => s.pendingIcloudOptIn);
  const setPendingIcloudOptIn = useWalletsStore((s) => s.setPendingIcloudOptIn);
  const commitPendingCreation = useWalletsStore((s) => s.commitPendingCreation);
  const cancelPendingCreation = useWalletsStore((s) => s.cancelPendingCreation);
  const [isCommitting, setIsCommitting] = useState(false);
  const [iCloudStatusMessage, setICloudStatusMessage] = useState<string | null>(
    null,
  );

  usePreventRemove(pendingWalletId !== null && !isCommitting, ({ data }) => {
    Alert.alert(
      "Cancel?",
      "Discard this recovery phrase? This action cannot be undone.",
      [
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
      ],
    );
  });

  const onFinish = useCallback(async (): Promise<void> => {
    if (pendingWalletId === null) return;

    // Local-only: defer commit to the warning screen so the user must
    // acknowledge the "no backup, no recovery" risk before we persist. The
    // Keychain item is already SE-wrapped local (beginPendingCreation
    // stored it that way), so no sync-state change is needed here.
    if (!pendingIcloudOptIn) {
      router.push("/(onboarding)/warning");
      return;
    }

    // iCloud opt-in: we need to migrate from the SE-wrapped local storage
    // to plaintext + synchronizable. The native module decrypts the
    // mnemonic (biometric prompt) and re-stores it under iCloud Keychain.
    // User-cancels here must not destroy the pending wallet — we simply
    // leave it on the SE-wrapped local path and let the user retry or
    // toggle off.
    setICloudStatusMessage(null);
    setIsCommitting(true);
    try {
      const address = await setSyncStateAndDeriveAddress(
        pendingWalletId,
        true,
        0,
        ICLOUD_MIGRATION_PROMPT,
      );
      await commitPendingCreation(address);
      router.replace("/(wallets)");
    } catch (err) {
      if (err instanceof WalletCryptoError) {
        if (err.code === "USER_CANCELED") {
          setICloudStatusMessage(
            "Wallet not saved. Authenticate to finish, or turn the switch off to continue without backup.",
          );
          return;
        }
        if (err.code === "BIOMETRY_UNAVAILABLE") {
          Alert.alert(
            "Biometrics required",
            "Creating this wallet requires Face ID, Touch ID, or a device passcode. Enable one in Settings and try again.",
          );
          return;
        }
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Failed to save", message);
    } finally {
      setIsCommitting(false);
    }
  }, [pendingIcloudOptIn, pendingWalletId, router, commitPendingCreation]);

  const openKeychainSettings = useCallback(async (): Promise<void> => {
    try {
      const canOpen = await Linking.canOpenURL(ICLOUD_KEYCHAIN_SETTINGS_URL);
      if (!canOpen) return;
      await Linking.openURL(ICLOUD_KEYCHAIN_SETTINGS_URL);
    } catch {
      // App-Prefs deep-linking is best-effort; on failure the static path in
      // the helper text is the fallback instruction.
    }
  }, []);

  const canPress = !isCommitting;

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName={`${SCREEN_PADDING} gap-6`}
    >
      <Stack.Screen options={{ headerRight: () => <CancelButton /> }} />
      <Text className="text-base leading-6 text-neutral-700">
        You can optionally back up an encrypted copy of your recovery phrase to
        iCloud Keychain. This lets you restore your wallet if you lose your
        device.
      </Text>

      <View className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <Text className="text-sm leading-5 text-neutral-700">
          iCloud Keychain backup is convenient but trusts Apple with your
          recovery infrastructure. For maximum security, write down your phrase
          regardless of this choice.
        </Text>
      </View>

      <View className="flex-row items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-4">
        <View className="flex-1 pr-3">
          <Text className="text-base font-medium text-neutral-900">
            Back up to iCloud Keychain
          </Text>
          <Text className="text-xs text-neutral-500">
            Requires iCloud Keychain enabled in Settings.
          </Text>
        </View>
        <Switch
          value={pendingIcloudOptIn}
          onValueChange={(next) => {
            setICloudStatusMessage(null);
            setPendingIcloudOptIn(next);
          }}
          disabled={isCommitting}
          trackColor={{ false: "#d4d4d4", true: "#171717" }}
          thumbColor="#ffffff"
          ios_backgroundColor="#d4d4d4"
        />
      </View>

      {pendingIcloudOptIn ? (
        <View className="gap-2">
          <Text className="text-sm leading-5 text-neutral-600">
            You'll be asked to authenticate once to create this wallet, derive
            its address, and prepare the recovery phrase for iCloud backup. It
            will be encrypted by iCloud Keychain and available on other devices
            signed into the same Apple ID.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              void openKeychainSettings();
            }}
            hitSlop={8}
          >
            <Text className="text-sm leading-5 text-neutral-500">
              Enable at: Settings → [Your Name] → iCloud → Passwords and
              Keychain.
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text className="text-sm leading-5 text-neutral-500">
          You'll see an important warning on the next screen.
        </Text>
      )}

      {iCloudStatusMessage !== null ? (
        <View className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Text className="text-sm leading-5 text-amber-900">
            {iCloudStatusMessage}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!canPress}
        onPress={() => {
          void onFinish();
        }}
        className={canPress ? PRIMARY_BUTTON : PRIMARY_BUTTON_DISABLED}
      >
        {isCommitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className={PRIMARY_BUTTON_TEXT}>Finish</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
