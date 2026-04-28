import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { WordGrid } from "@/components/WordGrid";
import { useBackgroundRouteGuard } from "@/hooks/useBackgroundRouteGuard";
import { WalletCryptoError } from "@/lib/storage/secure";
import { useWalletsStore } from "@/lib/stores/wallets";

const BIOMETRIC_PROMPT = "Authenticate to view your recovery phrase";

function splitMnemonic(mnemonic: string): string[] {
  return mnemonic.split(/\s+/).filter((w) => w.length > 0);
}

// TODO(stage-7): this screen currently only supports the onboarding
// "just-generated pending wallet" reveal path. The wallets-list reveal
// (biometric-gated view of an existing wallet's mnemonic) is deferred to
// a post-MVP stage; the native module's `revealMnemonic(id, prompt)` is
// already in place to support it.
export default function Reveal(): React.JSX.Element | null {
  const router = useRouter();
  const navigation = useNavigation();
  const pendingWalletId = useWalletsStore((s) => s.pendingWalletId);
  const cancelPendingCreation = useWalletsStore((s) => s.cancelPendingCreation);
  const revealPendingMnemonic = useWalletsStore((s) => s.revealPendingMnemonic);
  const hasExistingWallets = useWalletsStore((s) => s.wallets.length > 0);
  const [words, setWords] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userCanceled, setUserCanceled] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const readVersionRef = useRef(0);

  usePreventScreenCapture("reveal");
  useBackgroundRouteGuard(
    hasExistingWallets ? "/(wallets)" : "/(onboarding)/generate",
  );

  // Intercept swipe-back, hardware back, and header back-arrow. We always
  // prevent while a pending wallet exists — the only path out is Continue
  // or Cancel.
  usePreventRemove(pendingWalletId !== null, ({ data }) => {
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

  const loadMnemonic = useCallback(async (): Promise<void> => {
    const version = readVersionRef.current + 1;
    readVersionRef.current = version;
    setWords(null);
    setLoadError(null);
    setUserCanceled(false);

    try {
      const mnemonic = await revealPendingMnemonic(BIOMETRIC_PROMPT);
      if (version !== readVersionRef.current) return;
      if (mnemonic === null) {
        // `null` means either user canceled the biometric prompt OR the
        // item was not found. In the reveal-after-generate flow the
        // wallet was just written, so `null` is almost certainly a
        // user-cancel. Treat it as such.
        setUserCanceled(true);
        return;
      }
      setWords(splitMnemonic(mnemonic));
    } catch (err) {
      if (version !== readVersionRef.current) return;
      if (
        err instanceof WalletCryptoError &&
        err.code === "BIOMETRY_UNAVAILABLE"
      ) {
        // The wallet got stored but we cannot read it back without
        // biometrics. This is recoverable only by enabling biometrics /
        // passcode — tell the user and clean up the orphan.
        Alert.alert(
          "Biometrics required",
          "This wallet requires Face ID, Touch ID, or a device passcode to view its recovery phrase. Enable one in Settings and try again.",
          [
            {
              text: "OK",
              onPress: () => {
                void (async () => {
                  await cancelPendingCreation();
                  router.replace("/(onboarding)/generate");
                })();
              },
            },
          ],
        );
        return;
      }
      setLoadError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [cancelPendingCreation, revealPendingMnemonic, router]);

  useEffect(() => {
    if (pendingWalletId === null) {
      router.replace("/(onboarding)/generate");
      return;
    }
    void loadMnemonic();
    return () => {
      // Bump the version guard so any in-flight read ignores its result on
      // unmount, and drop the plaintext reference as early as possible.
      readVersionRef.current += 1;
      setWords(null);
    };
  }, [pendingWalletId, router, loadMnemonic]);

  const onContinue = useCallback((): void => {
    router.push("/(onboarding)/confirm");
  }, [router]);

  if (pendingWalletId === null) {
    return null;
  }

  if (loadError !== null) {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName={`${SCREEN_PADDING} gap-4`}
      >
        <Stack.Screen options={{ headerRight: () => <CancelButton /> }} />
        <Text className="text-base text-red-600">{loadError}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void loadMnemonic();
          }}
          className={PRIMARY_BUTTON}
        >
          <Text className={PRIMARY_BUTTON_TEXT}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (userCanceled) {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName={`${SCREEN_PADDING} gap-4`}
      >
        <Stack.Screen options={{ headerRight: () => <CancelButton /> }} />
        <Text className="text-lg font-semibold text-neutral-900">
          Authentication canceled
        </Text>
        <Text className="text-base leading-6 text-neutral-700">
          Your recovery phrase is protected by biometric authentication. Tap
          below to authenticate and view your 24 words.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void loadMnemonic();
          }}
          className={PRIMARY_BUTTON}
        >
          <Text className={PRIMARY_BUTTON_TEXT}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (words === null) {
    return (
      <View className="flex-1 items-center justify-center bg-white gap-4">
        <Stack.Screen options={{ headerRight: () => <CancelButton /> }} />
        <ActivityIndicator color="#171717" />
        <Text className="text-sm text-neutral-500">
          Authenticate to view your recovery phrase
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName={`${SCREEN_PADDING} gap-5`}
    >
      <Stack.Screen options={{ headerRight: () => <CancelButton /> }} />

      <View className={WARNING_CALLOUT}>
        <Text className={WARNING_CALLOUT_TEXT}>
          Write these 24 words down in order on paper. Store them somewhere
          safe. Anyone with these words controls the wallet. Never share them.
        </Text>
      </View>

      <WordGrid words={words} />

      <Checkbox
        checked={acknowledged}
        onToggle={() => {
          setAcknowledged((v) => !v);
        }}
        label="I have written down my recovery phrase"
      />

      <Pressable
        accessibilityRole="button"
        disabled={!acknowledged}
        onPress={onContinue}
        className={acknowledged ? PRIMARY_BUTTON : PRIMARY_BUTTON_DISABLED}
      >
        <Text className={PRIMARY_BUTTON_TEXT}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}
