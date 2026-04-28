import { useRouter } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "@/components/styles";
import { readManifest } from "@/lib/storage/secure";
import { useWalletsStore } from "@/lib/stores/wallets";
import type { WalletManifest, WalletManifestEntry } from "@/lib/types";

/**
 * First-launch-on-new-device flow. The loading screen routes here when MMKV
 * is empty but a synced manifest is found in the Keychain.
 *
 * As of Stage 6 the restore path does not touch plaintext mnemonics in JS:
 * the native module confirms each wallet is locally present via
 * `mnemonicExists` and the Keychain items are left exactly as iOS synced them.
 *
 * Follow-up (Stage 6b): once biometric gating lands, consider showing a
 * per-wallet "reveal" button here so users can verify a restored mnemonic
 * before trusting it.
 */
export default function Restore(): React.JSX.Element {
  const router = useRouter();
  const restoreFromManifestNative = useWalletsStore(
    (s) => s.restoreFromManifestNative,
  );
  const [manifest, setManifest] = useState<WalletManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);

  usePreventScreenCapture("restore");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await readManifest();
        if (cancelled) return;
        if (m === null || m.entries.length === 0) {
          router.replace("/(onboarding)/generate");
          return;
        }
        setManifest(m);
      } catch {
        if (cancelled) return;
        Alert.alert(
          "iCloud backup could not be read",
          "Your iCloud backup could not be read. You can start fresh or contact support.",
          [
            {
              text: "OK",
              onPress: () => {
                router.replace("/(onboarding)/generate");
              },
            },
          ],
        );
      } finally {
        if (!cancelled) setLoadingManifest(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const onRestore = useCallback(async (): Promise<void> => {
    if (manifest === null) return;
    setIsRestoring(true);
    setRestoreProgress(`Restoring 0 of ${manifest.entries.length}...`);

    try {
      const restored = await restoreFromManifestNative(manifest, {
        onProgress: ({ completed, total }) => {
          setRestoreProgress(`Restoring ${completed} of ${total}...`);
        },
        shouldContinueAfterCancel: async () =>
          new Promise<boolean>((resolve) => {
            Alert.alert(
              "Authentication canceled",
              "Continue restoring remaining wallets, or stop?",
              [
                {
                  text: "Stop",
                  style: "cancel",
                  onPress: () => resolve(false),
                },
                { text: "Continue", onPress: () => resolve(true) },
              ],
            );
          }),
      });
      if (restored.length === 0) {
        Alert.alert(
          "No wallets could be restored",
          "None of the backed-up wallets could be read locally. iCloud Keychain may be disabled, or the sync has not completed yet. Try again later or start fresh.",
          [
            {
              text: "OK",
              onPress: () => {
                router.replace("/(onboarding)/generate");
              },
            },
          ],
        );
        return;
      }
      if (restored.length < manifest.entries.length) {
        Alert.alert(
          "Restore partially complete",
          `Restored ${restored.length} of ${manifest.entries.length} wallets. Some wallets could not be authenticated or read.`,
          [
            {
              text: "Continue",
              onPress: () => {
                router.replace("/(wallets)");
              },
            },
          ],
        );
        return;
      }
      router.replace("/(wallets)");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(
        "Restore failed",
        `iCloud Keychain may be disabled. Enable it in Settings and try again.\n\n${message}`,
      );
    } finally {
      setIsRestoring(false);
      setRestoreProgress(null);
    }
  }, [manifest, restoreFromManifestNative, router]);

  const onStartFresh = useCallback((): void => {
    Alert.alert(
      "Start fresh?",
      "This will ignore your iCloud backup and start with a new wallet. Your backup will remain in iCloud unless you delete it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start fresh",
          style: "destructive",
          onPress: () => {
            router.replace("/(onboarding)/generate");
          },
        },
      ],
    );
  }, [router]);

  if (loadingManifest) {
    return (
      <View
        className={`flex-1 items-center justify-center bg-white ${SCREEN_PADDING}`}
      >
        <ActivityIndicator color="#404040" />
      </View>
    );
  }

  if (manifest === null) {
    return <View className="flex-1 bg-white" />;
  }

  return (
    <View className="flex-1 bg-white">
      <View className={`${SCREEN_PADDING} gap-3`}>
        <Text className="text-base leading-6 text-neutral-700">
          We found wallets backed up to your iCloud Keychain. Would you like to
          restore them?
        </Text>
        <Text className="text-sm leading-5 text-neutral-500">
          On a physical device, you'll be asked to authenticate once for each
          wallet so the app can derive its primary address. Additional backed-up
          accounts can be restored later from the wallet detail screen.
        </Text>
      </View>

      <FlatList
        data={manifest.entries}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <ManifestRow entry={item} />}
        contentContainerClassName={`${SCREEN_PADDING} gap-3`}
      />

      <View className={`${SCREEN_PADDING} gap-3`}>
        {restoreProgress !== null ? (
          <Text className="text-sm text-neutral-500">{restoreProgress}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={isRestoring}
          onPress={() => {
            void onRestore();
          }}
          className={isRestoring ? PRIMARY_BUTTON_DISABLED : PRIMARY_BUTTON}
        >
          {isRestoring ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className={PRIMARY_BUTTON_TEXT}>Restore wallets</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isRestoring}
          onPress={onStartFresh}
          className={SECONDARY_BUTTON}
        >
          <Text className={SECONDARY_BUTTON_TEXT}>Start fresh instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ManifestRowProps {
  entry: WalletManifestEntry;
}

function ManifestRow({ entry }: ManifestRowProps): React.JSX.Element {
  const createdLabel = new Date(entry.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <View className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
      <Text className="text-base font-semibold text-neutral-900">
        {entry.label}
      </Text>
      <View className="mt-1 flex-row gap-2">
        <Text className="text-xs text-neutral-500">Created {createdLabel}</Text>
        {entry.icloudBackedUp ? (
          <Text className="text-xs text-neutral-500">· ☁️ iCloud</Text>
        ) : null}
      </View>
    </View>
  );
}
