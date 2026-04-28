import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useWalletsStore } from "@/lib/stores/wallets";

export interface CancelButtonProps {
  confirmMessage?: string;
  confirmLabel?: string;
}

const DEFAULT_CONFIRM_MESSAGE =
  "Discard this recovery phrase? This action cannot be undone.";
const DEFAULT_CONFIRM_LABEL = "Discard";

/**
 * Header-right "Cancel" affordance for the onboarding flow.
 *
 * On confirmation, awaits `cancelPendingCreation` (which deletes the orphaned
 * Keychain entry via the native module) before routing to the wallets list,
 * or back to the onboarding entry point if no wallets exist yet.
 */
export function CancelButton({
  confirmMessage = DEFAULT_CONFIRM_MESSAGE,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
}: CancelButtonProps): React.JSX.Element {
  const router = useRouter();
  const cancelPendingCreation = useWalletsStore((s) => s.cancelPendingCreation);

  const onPress = useCallback((): void => {
    Alert.alert("Cancel?", confirmMessage, [
      { text: "Keep", style: "default" },
      {
        text: confirmLabel,
        style: "destructive",
        onPress: () => {
          void (async () => {
            await cancelPendingCreation();
            const hasWallets = useWalletsStore.getState().wallets.length > 0;
            if (hasWallets) {
              router.replace("/(wallets)");
            } else {
              router.replace("/(onboarding)/generate");
            }
          })();
        },
      },
    ]);
  }, [cancelPendingCreation, confirmLabel, confirmMessage, router]);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={12}>
      <Text className="text-base font-medium text-neutral-700">Cancel</Text>
    </Pressable>
  );
}
