import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { runSecurityChecks } from "@/lib/security/jailbreak";
import { readManifest } from "@/lib/storage/secure";
import { useNetworksStore } from "@/lib/stores/networks";
import { useWalletsStore } from "@/lib/stores/wallets";

const MIN_DISPLAY_MS = 500;

export default function LoadingRouter(): React.JSX.Element {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    useWalletsStore.getState().hydrate();
    useNetworksStore.getState().hydrate();

    void (async () => {
      const [securityResult, manifest] = await Promise.all([
        runSecurityChecks().catch(() => ({
          jailbroken: false,
          debugged: false,
          hooked: false,
        })),
        resolveManifest(),
      ]);
      if (cancelled) return;

      const { setSecurityWarning, wallets } = useWalletsStore.getState();
      if (
        securityResult.jailbroken ||
        securityResult.debugged ||
        securityResult.hooked
      ) {
        setSecurityWarning(securityResult);
      } else {
        setSecurityWarning(null);
      }

      const elapsed = Date.now() - startedAt;
      const delay = Math.max(0, MIN_DISPLAY_MS - elapsed);

      setTimeout(() => {
        if (cancelled) return;
        if (wallets.length > 0) {
          router.replace("/(wallets)");
          return;
        }
        if (manifest !== null && manifest.entries.length > 0) {
          router.replace("/(onboarding)/restore");
          return;
        }
        router.replace("/(onboarding)/generate");
      }, delay);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <StatusBar style="auto" />
      <View className="flex-1 items-center justify-center gap-4">
        <Text className="text-2xl font-semibold text-neutral-900">Wallet</Text>
        <ActivityIndicator color="#404040" />
      </View>
    </SafeAreaView>
  );
}

/**
 * Resolve the iCloud manifest. Treats any failure as "no manifest" — a
 * corrupted or unavailable manifest must not block app launch.
 */
async function resolveManifest() {
  try {
    return await readManifest();
  } catch (err) {
    console.warn(`readManifest failed: ${String(err)}`);
    return null;
  }
}
