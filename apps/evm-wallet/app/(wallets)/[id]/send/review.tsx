import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  DESTRUCTIVE_BUTTON,
  DESTRUCTIVE_BUTTON_DISABLED,
  DESTRUCTIVE_BUTTON_TEXT,
  SCREEN_PADDING,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "@/components/styles";
import { signAndSendTransaction } from "@/lib/crypto/signing";
import {
  categorizeTxError,
  formatBalanceWithSymbol,
  truncateAddress,
} from "@/lib/format";
import { isRunningOnSimulator } from "@/lib/storage/secure";
import { getActiveNetwork, useNetworksStore } from "@/lib/stores/networks";
import { useSendStore } from "@/lib/stores/send";
import { useWalletsStore } from "@/lib/stores/wallets";
import { getAccountDisplayName } from "@/lib/types";

export default function ReviewSendScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const draft = useSendStore((s) => s.draft);
  const clearDraft = useSendStore((s) => s.clearDraft);
  const wallet = useWalletsStore((s) => s.wallets.find((w) => w.id === id));
  const networks = useNetworksStore((s) => s.networks);
  const activeNetworkId = useNetworksStore((s) => s.activeNetworkId);
  const activeNetwork = getActiveNetwork(networks, activeNetworkId);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const account =
    draft && wallet
      ? wallet.accounts.find((item) => item.index === draft.accountIndex)
      : undefined;
  const draftNetwork = draft
    ? networks.find((network) => network.id === draft.networkId)
    : undefined;
  const networkChanged = Boolean(
    draft && activeNetwork?.id !== draft.networkId,
  );
  const feeWei =
    draft && draftNetwork
      ? draft.estimatedGasLimit * draft.estimatedMaxFeePerGas
      : 0n;
  const totalWei = draft ? draft.amountWei + feeWei : 0n;
  const signingPromptCopy =
    isRunningOnSimulator() || wallet?.icloudBackedUp === true
      ? "Tap Confirm to sign and send this transaction."
      : "You'll be asked to authenticate to sign this transaction.";

  const handleEdit = useCallback(() => {
    if (!draft) return;
    router.back();
  }, [draft, router]);

  const handleStartOver = useCallback(() => {
    if (!draft) return;
    clearDraft();
    router.replace({
      pathname: "/(wallets)/[id]/send/[accountIndex]",
      params: { id: draft.walletId, accountIndex: String(draft.accountIndex) },
    } as never);
  }, [clearDraft, draft, router]);

  const handleConfirm = useCallback(async () => {
    if (!draft || !draftNetwork || networkChanged) return;
    setSending(true);
    setErrorMessage(null);
    try {
      const hash = await signAndSendTransaction({
        walletId: draft.walletId,
        accountIndex: draft.accountIndex,
        to: draft.to,
        value: draft.amountWei,
        network: draftNetwork,
        gasOverrides: {
          maxFeePerGas: draft.estimatedMaxFeePerGas,
          maxPriorityFeePerGas: draft.estimatedMaxPriorityFeePerGas,
          gasLimit: draft.estimatedGasLimit,
        },
        authPrompt: "Authenticate to sign transaction",
      });
      clearDraft();
      router.replace({
        pathname: "/(wallets)/[id]/send/result",
        params: { id: draft.walletId, hash, networkId: draftNetwork.id },
      } as never);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const categorized = categorizeTxError(error);
      if (categorized.kind !== "user_canceled") {
        setErrorMessage(categorized.message);
      }
    } finally {
      setSending(false);
    }
  }, [clearDraft, draft, draftNetwork, networkChanged, router]);

  if (!draft || !wallet || !account || !draftNetwork) {
    return (
      <View
        className={`flex-1 items-center justify-center bg-white ${SCREEN_PADDING}`}
      >
        <Stack.Screen options={{ title: "Review transaction" }} />
        <Text className="text-base text-neutral-500">
          No transaction draft found.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.replace({
              pathname: "/(wallets)/[id]",
              params: { id: id ?? "" },
            } as never);
          }}
          className={`mt-4 ${SECONDARY_BUTTON}`}
        >
          <Text className={SECONDARY_BUTTON_TEXT}>Back to wallet</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <Stack.Screen options={{ title: "Review transaction" }} />
      <ScrollView contentContainerClassName={`${SCREEN_PADDING} gap-5`}>
        {networkChanged ? (
          <View className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Text className="text-sm font-semibold text-amber-950">
              Network changed since you started this transaction.
            </Text>
            <Text className="mt-1 text-sm leading-5 text-amber-900">
              This draft was created for {draftNetwork.name}. Please start over
              before signing.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={handleStartOver}
              className={`mt-3 ${SECONDARY_BUTTON}`}
            >
              <Text className={SECONDARY_BUTTON_TEXT}>Start over</Text>
            </Pressable>
          </View>
        ) : null}

        <ReviewSection title="From">
          <Text className="text-base font-semibold text-neutral-900">
            {getAccountDisplayName(account)}
          </Text>
          <Text className="mt-1 font-mono text-sm text-neutral-600">
            {truncateAddress(account.address)}
          </Text>
          <Text className="mt-2 text-sm text-neutral-700">
            Network: {draftNetwork.name} · {draftNetwork.currencySymbol}
          </Text>
        </ReviewSection>

        <ReviewSection title="To">
          <View className="rounded-xl border border-neutral-300 bg-white p-3">
            <Text className="font-mono text-sm leading-6 text-neutral-900">
              {groupAddress(draft.to)}
            </Text>
          </View>
        </ReviewSection>

        <ReviewSection title="Summary">
          <SummaryLine
            label="Amount"
            value={formatBalanceWithSymbol(
              draft.amountWei,
              draftNetwork.currencySymbol,
            )}
          />
          <SummaryLine
            label={`Network fee · ${labelForPreset(draft.gasPreset)}`}
            value={formatBalanceWithSymbol(feeWei, draftNetwork.currencySymbol)}
          />
          <View className="mt-3 border-t border-neutral-200 pt-3">
            <SummaryLine
              label="Total"
              value={formatBalanceWithSymbol(
                totalWei,
                draftNetwork.currencySymbol,
              )}
              strong
            />
          </View>
        </ReviewSection>

        {errorMessage ? (
          <View className="rounded-xl border border-red-200 bg-red-50 p-4">
            <Text className="text-sm text-red-900">{errorMessage}</Text>
          </View>
        ) : null}

        <View className="gap-3">
          <Pressable
            accessibilityRole="button"
            disabled={sending}
            onPress={handleEdit}
            className={SECONDARY_BUTTON}
          >
            <Text className={SECONDARY_BUTTON_TEXT}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={sending || networkChanged}
            onPress={() => {
              void handleConfirm();
            }}
            className={
              sending || networkChanged
                ? DESTRUCTIVE_BUTTON_DISABLED
                : DESTRUCTIVE_BUTTON
            }
          >
            {sending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className={DESTRUCTIVE_BUTTON_TEXT}>Confirm and send</Text>
            )}
          </Pressable>
          <Text className="text-center text-sm leading-5 text-neutral-600">
            {signingPromptCopy}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </Text>
      {children}
    </View>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row justify-between gap-4">
      <Text
        className={
          strong
            ? "text-base font-semibold text-neutral-900"
            : "text-sm text-neutral-600"
        }
      >
        {label}
      </Text>
      <Text
        className={
          strong
            ? "text-base font-semibold text-neutral-900"
            : "text-sm font-medium text-neutral-900"
        }
      >
        {value}
      </Text>
    </View>
  );
}

function groupAddress(address: string): string {
  const prefix = address.slice(0, 2);
  const body = address.slice(2);
  return `${prefix} ${body.match(/.{1,4}/g)?.join(" ") ?? body}`;
}

function labelForPreset(preset: string): string {
  switch (preset) {
    case "slow":
      return "Slow";
    case "fast":
      return "Fast";
    default:
      return "Normal";
  }
}
