import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
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
import { biometricLabel } from "@/lib/security/biometrics";
import { isRunningOnSimulator, WalletCryptoError } from "@/lib/storage/secure";
import { useWalletsStore } from "@/lib/stores/wallets";

export default function Generate(): React.JSX.Element {
  const router = useRouter();
  const runningOnSimulator = isRunningOnSimulator();
  const beginPendingCreation = useWalletsStore((s) => s.beginPendingCreation);
  const hasExistingWallets = useWalletsStore((s) => s.wallets.length > 0);
  const biometricCapability = useWalletsStore((s) => s.biometricCapability);
  const ensureBiometricCapability = useWalletsStore(
    (s) => s.ensureBiometricCapability,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [capabilityChecked, setCapabilityChecked] = useState(
    runningOnSimulator || biometricCapability !== null,
  );

  useEffect(() => {
    if (runningOnSimulator) {
      setCapabilityChecked(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      await ensureBiometricCapability();
      if (!cancelled) setCapabilityChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureBiometricCapability, runningOnSimulator]);

  const onGenerate = useCallback(async (): Promise<void> => {
    setIsGenerating(true);
    try {
      // Generation, entropy handling, AES encryption, Secure Enclave
      // wrapping, and Keychain storage all happen in the native module.
      // JS only gets back the wallet id.
      await beginPendingCreation();
      router.push("/(onboarding)/reveal");
    } catch (err) {
      if (
        err instanceof WalletCryptoError &&
        err.code === "BIOMETRY_UNAVAILABLE"
      ) {
        Alert.alert(
          "Biometrics required",
          "This wallet app requires Face ID, Touch ID, or a device passcode. Please enable one in Settings, then try again.",
        );
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Error", message);
    } finally {
      setIsGenerating(false);
    }
  }, [beginPendingCreation, router]);

  // Pre-flight gate: if biometrics hardware is missing or no identity is
  // enrolled, block or warn before we try to create an SE-backed wallet.
  // `.userPresence` falls back to device passcode when biometrics are
  // disabled, so we allow "Continue anyway" in the "enrolled=false,
  // available=true" case — the user will be prompted for their passcode
  // on reveal.
  if (!capabilityChecked) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  if (
    !runningOnSimulator &&
    biometricCapability !== null &&
    !biometricCapability.available
  ) {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName={`${SCREEN_PADDING} gap-4`}
      >
        <Text className="text-lg font-semibold text-neutral-900">
          Unsupported device
        </Text>
        <Text className="text-base leading-6 text-neutral-700">
          This device does not support secure key storage. A physical iPhone
          with Face ID or Touch ID is required.
        </Text>
      </ScrollView>
    );
  }

  if (
    !runningOnSimulator &&
    biometricCapability !== null &&
    !biometricCapability.enrolled
  ) {
    const label = biometricLabel(biometricCapability.type);
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName={`${SCREEN_PADDING} gap-4`}
      >
        <Text className="text-lg font-semibold text-neutral-900">
          {label === "biometrics" ? "Biometrics required" : `${label} required`}
        </Text>
        <Text className="text-base leading-6 text-neutral-700">
          This wallet uses{" "}
          {label === "biometrics" ? "Face ID or Touch ID" : label} to protect
          your recovery phrase. Please enroll a biometric or set a device
          passcode in Settings, then return here.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void Linking.openSettings();
          }}
          className={PRIMARY_BUTTON}
        >
          <Text className={PRIMARY_BUTTON_TEXT}>Open Settings</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isGenerating}
          onPress={() => {
            void onGenerate();
          }}
          className="items-center py-3"
        >
          {isGenerating ? (
            <ActivityIndicator color="#404040" />
          ) : (
            <Text className="text-sm text-neutral-500">
              Continue anyway (uses device passcode)
            </Text>
          )}
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName={`${SCREEN_PADDING} gap-6`}
    >
      {hasExistingWallets ? (
        <Stack.Screen options={{ headerRight: () => <CancelButton /> }} />
      ) : null}
      {runningOnSimulator ? (
        <View className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Text className="text-sm leading-5 text-amber-900">
            Simulator mode: recovery phrases use plaintext Keychain storage
            without Secure Enclave or biometric/passcode protection. Use a
            physical iPhone to validate wallet security.
          </Text>
        </View>
      ) : null}
      <View className="gap-4">
        <Text className="text-base leading-6 text-neutral-700">
          Your recovery phrase is a list of 24 words that completely controls
          this wallet. Together, they are your wallet — no email, no password,
          no account.
        </Text>
        <Text className="text-base leading-6 text-neutral-700">
          Why it matters: if you lose your device and don't have these 24 words
          written down, your funds are gone. There is no password reset, no
          support line, and no way for us to recover them for you.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={isGenerating}
        onPress={() => {
          void onGenerate();
        }}
        className={isGenerating ? PRIMARY_BUTTON_DISABLED : PRIMARY_BUTTON}
      >
        {isGenerating ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className={PRIMARY_BUTTON_TEXT}>Generate Recovery Phrase</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
