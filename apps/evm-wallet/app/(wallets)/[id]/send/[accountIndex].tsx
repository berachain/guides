import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { formatUnits, parseEther } from "viem";
import { BalanceSkeleton } from "@/components/BalanceSkeleton";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "@/components/styles";
import { categorizeBalanceError, useBalance } from "@/hooks/useBalance";
import { type GasEstimate, useGasEstimate } from "@/hooks/useGasEstimate";
import {
  hexToBytes,
  isValidEvmAddress,
  toChecksumAddress,
} from "@/lib/crypto/evm";
import {
  categorizeTxError,
  formatBalanceWithSymbol,
  truncateAddress,
} from "@/lib/format";
import { getActiveNetwork, useNetworksStore } from "@/lib/stores/networks";
import { type GasPreset, useSendStore } from "@/lib/stores/send";
import { useWalletsStore } from "@/lib/stores/wallets";
import { getAccountDisplayName } from "@/lib/types";

type AddressStatus = "empty" | "invalid" | "checksum_warning" | "valid";

const GAS_PRESETS: Array<{ key: GasPreset; label: string; numerator: bigint }> =
  [
    { key: "slow", label: "Slow", numerator: 100n },
    { key: "normal", label: "Normal", numerator: 125n },
    { key: "fast", label: "Fast", numerator: 150n },
  ];

export default function SendScreen(): React.JSX.Element {
  const { id, accountIndex } = useLocalSearchParams<{
    id: string;
    accountIndex: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const draft = useSendStore((s) => s.draft);
  const setDraft = useSendStore((s) => s.setDraft);
  const clearDraft = useSendStore((s) => s.clearDraft);
  const wallet = useWalletsStore((s) => s.wallets.find((w) => w.id === id));
  const networks = useNetworksStore((s) => s.networks);
  const activeNetworkId = useNetworksStore((s) => s.activeNetworkId);
  const activeNetwork = getActiveNetwork(networks, activeNetworkId);
  const parsedAccountIndex = Number.parseInt(accountIndex ?? "", 10);
  const account = wallet?.accounts.find((a) => a.index === parsedAccountIndex);
  const matchingDraft =
    draft?.walletId === id && draft.accountIndex === parsedAccountIndex
      ? draft
      : null;
  const [toInput, setToInput] = useState(matchingDraft?.to ?? "");
  const [amountInput, setAmountInput] = useState(
    matchingDraft ? formatUnits(matchingDraft.amountWei, 18) : "",
  );
  const [gasPreset, setGasPreset] = useState<GasPreset>(
    matchingDraft?.gasPreset ?? "normal",
  );
  const [refreshing, setRefreshing] = useState(false);

  const addressStatus = useMemo(() => getAddressStatus(toInput), [toInput]);
  const toAddress = /^0x[0-9a-fA-F]{40}$/.test(toInput)
    ? (toInput as `0x${string}`)
    : undefined;
  const amountWei = useMemo(() => parseAmount(amountInput), [amountInput]);
  const balance = useBalance(account?.address, activeNetwork?.id);
  const gasEstimate = useGasEstimate(
    activeNetwork ?? undefined,
    toAddress,
    account?.address as `0x${string}` | undefined,
    amountWei ?? 0n,
  );
  const selectedFee = gasEstimate.data
    ? feeForPreset(gasEstimate.data, gasPreset)
    : null;
  const spendableWei =
    balance.data && selectedFee
      ? maxBigint(balance.data.value - selectedFee.estimatedFeeWei, 0n)
      : null;
  const totalWei =
    amountWei !== null && selectedFee
      ? amountWei + selectedFee.estimatedFeeWei
      : null;
  const amountError = getAmountError(amountInput, amountWei, spendableWei);
  const totalTooHigh =
    totalWei !== null && balance.data !== undefined
      ? totalWei > balance.data.value
      : false;
  const canReview =
    Boolean(activeNetwork && account && toAddress) &&
    addressStatus !== "invalid" &&
    amountWei !== null &&
    amountWei > 0n &&
    amountError === null &&
    selectedFee !== null &&
    balance.data !== undefined &&
    !totalTooHigh;
  const dirty =
    toInput.length > 0 || amountInput.length > 0 || gasPreset !== "normal";

  const leaveToWallet = useCallback(() => {
    clearDraft();
    router.replace({
      pathname: "/(wallets)/[id]",
      params: { id: id ?? "" },
    } as never);
  }, [clearDraft, id, router]);

  const requestCancel = useCallback(() => {
    if (!dirty) {
      leaveToWallet();
      return;
    }
    Alert.alert("Cancel send?", "Your transaction draft will be discarded.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: leaveToWallet },
    ]);
  }, [dirty, leaveToWallet]);

  const handlePaste = useCallback(async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    setToInput(value);
  }, []);

  const handleMax = useCallback(() => {
    if (spendableWei === null) return;
    setAmountInput(formatUnits(spendableWei, 18));
  }, [spendableWei]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gasEstimate"] }),
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const handleReview = useCallback(() => {
    if (
      !canReview ||
      !activeNetwork ||
      !toAddress ||
      amountWei === null ||
      !selectedFee
    )
      return;
    setDraft({
      walletId: id,
      accountIndex: parsedAccountIndex,
      networkId: activeNetwork.id,
      to: toAddress,
      amountWei,
      gasPreset,
      estimatedMaxFeePerGas: selectedFee.maxFeePerGas,
      estimatedMaxPriorityFeePerGas: selectedFee.maxPriorityFeePerGas,
      estimatedGasLimit: selectedFee.gasLimit,
    });
    router.push({
      pathname: "/(wallets)/[id]/send/review",
      params: { id },
    } as never);
  }, [
    activeNetwork,
    amountWei,
    canReview,
    gasPreset,
    id,
    parsedAccountIndex,
    router,
    selectedFee,
    setDraft,
    toAddress,
  ]);

  if (!wallet || !account) {
    return (
      <View
        className={`flex-1 items-center justify-center bg-white ${SCREEN_PADDING}`}
      >
        <Text className="text-base text-neutral-500">Account not found.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-white"
    >
      <Stack.Screen
        options={{
          title: `Send ${activeNetwork?.currencySymbol ?? ""}`.trim(),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={requestCancel}
            >
              <Text className="text-sm font-medium text-neutral-700">
                Cancel
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={`${SCREEN_PADDING} gap-5`}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <Section title="From">
          <Text className="text-base font-semibold text-neutral-900">
            {getAccountDisplayName(account)}
          </Text>
          <Text className="mt-1 font-mono text-sm text-neutral-600">
            {truncateAddress(account.address)}
          </Text>
          <Text className="mt-2 text-sm text-neutral-700">
            Network:{" "}
            {activeNetwork
              ? `${activeNetwork.name} · ${activeNetwork.currencySymbol}`
              : "None"}
          </Text>
          <BalanceReadout
            balance={balance}
            symbol={activeNetwork?.currencySymbol}
          />
        </Section>

        <Section title="To">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={toInput}
              onChangeText={setToInput}
              placeholder="0x..."
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              textContentType="none"
              className="flex-1 rounded-xl border border-neutral-300 px-3 py-3 font-mono text-sm text-neutral-900"
            />
            <Pressable
              accessibilityRole="button"
              onPress={handlePaste}
              className="rounded-xl border border-neutral-300 px-4 py-3 active:bg-neutral-100"
            >
              <Text className="text-sm font-medium text-neutral-700">
                Paste
              </Text>
            </Pressable>
          </View>
          <AddressValidation status={addressStatus} />
        </Section>

        <Section title="Amount">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="0.0"
              keyboardType="decimal-pad"
              className="flex-1 rounded-xl border border-neutral-300 px-3 py-3 text-base text-neutral-900"
            />
            <Text className="min-w-12 text-base font-semibold text-neutral-900">
              {activeNetwork?.currencySymbol ?? ""}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={spendableWei === null}
              onPress={handleMax}
              className={`rounded-xl px-4 py-3 ${
                spendableWei === null
                  ? "bg-neutral-200"
                  : "bg-neutral-900 active:bg-neutral-800"
              }`}
            >
              <Text
                className={`text-sm font-medium ${spendableWei === null ? "text-neutral-500" : "text-white"}`}
              >
                Max
              </Text>
            </Pressable>
          </View>
          {amountError ? (
            <Text className="mt-2 text-sm text-red-600">{amountError}</Text>
          ) : null}
        </Section>

        <Section title="Network fee">
          {gasEstimate.isPending ? (
            <Text className="text-sm text-neutral-500">Estimating...</Text>
          ) : null}
          {gasEstimate.error ? (
            <GasError
              error={gasEstimate.error}
              onRetry={() => void gasEstimate.refetch()}
            />
          ) : null}
          {gasEstimate.data && selectedFee ? (
            <View className="gap-3">
              <View className="flex-row gap-2">
                {GAS_PRESETS.map((preset) => (
                  <Pressable
                    key={preset.key}
                    accessibilityRole="button"
                    onPress={() => {
                      setGasPreset(preset.key);
                    }}
                    className={`rounded-full px-4 py-2 ${
                      gasPreset === preset.key
                        ? "bg-neutral-900"
                        : "bg-neutral-100"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        gasPreset === preset.key
                          ? "text-white"
                          : "text-neutral-700"
                      }`}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-neutral-700">
                  ≈{" "}
                  {formatBalanceWithSymbol(
                    selectedFee.estimatedFeeWei,
                    activeNetwork?.currencySymbol ?? "",
                  )}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  onPress={() => {
                    Alert.alert(
                      "Network fee",
                      "Faster transactions cost more. The actual fee depends on network conditions when your transaction is mined.",
                    );
                  }}
                >
                  <Text className="text-lg text-neutral-500">ⓘ</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Section>

        <Section title="Total">
          <SummaryLine
            label="Amount"
            value={amountWei ?? 0n}
            symbol={activeNetwork?.currencySymbol}
          />
          <SummaryLine
            label="Network fee"
            value={selectedFee?.estimatedFeeWei ?? 0n}
            symbol={activeNetwork?.currencySymbol}
          />
          <View className="mt-2 border-t border-neutral-200 pt-3">
            <SummaryLine
              label="Total"
              value={totalWei ?? 0n}
              symbol={activeNetwork?.currencySymbol}
              danger={totalTooHigh}
            />
            {totalTooHigh ? (
              <Text className="mt-2 text-sm text-red-600">
                Insufficient funds — reduce amount or you cannot afford this
                transaction.
              </Text>
            ) : null}
          </View>
        </Section>

        <Pressable
          accessibilityRole="button"
          disabled={!canReview}
          onPress={handleReview}
          className={canReview ? PRIMARY_BUTTON : PRIMARY_BUTTON_DISABLED}
        >
          <Text className={PRIMARY_BUTTON_TEXT}>Review transaction</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({
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

function BalanceReadout({
  balance,
  symbol,
}: {
  balance: ReturnType<typeof useBalance>;
  symbol: string | undefined;
}): React.JSX.Element {
  if (balance.isPending || balance.isFetching) {
    return (
      <View className="mt-2">
        <BalanceSkeleton />
      </View>
    );
  }
  if (balance.error) {
    const error = categorizeBalanceError(balance.error);
    return (
      <Text className="mt-2 text-sm text-red-600">
        Balance unavailable: {error.message}
      </Text>
    );
  }
  return (
    <Text className="mt-2 text-sm text-neutral-700">
      Balance:{" "}
      {formatBalanceWithSymbol(balance.data?.value ?? 0n, symbol ?? "")}
    </Text>
  );
}

function AddressValidation({
  status,
}: {
  status: AddressStatus;
}): React.JSX.Element | null {
  if (status === "empty") return null;
  if (status === "invalid") {
    return (
      <Text className="mt-2 text-sm text-red-600">Not a valid EVM address</Text>
    );
  }
  if (status === "checksum_warning") {
    return (
      <Text className="mt-2 text-sm text-amber-700">
        Address checksum invalid — check for typos
      </Text>
    );
  }
  return <Text className="mt-2 text-sm text-green-700">✓ Valid address</Text>;
}

function GasError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}): React.JSX.Element {
  const categorized = categorizeTxError(error);
  return (
    <View className="gap-3">
      <Text className="text-sm text-red-600">{categorized.message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className={SECONDARY_BUTTON}
      >
        <Text className={SECONDARY_BUTTON_TEXT}>Retry estimate</Text>
      </Pressable>
    </View>
  );
}

function SummaryLine({
  label,
  value,
  symbol,
  danger = false,
}: {
  label: string;
  value: bigint;
  symbol: string | undefined;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row justify-between">
      <Text
        className={
          danger
            ? "text-sm font-medium text-red-600"
            : "text-sm text-neutral-600"
        }
      >
        {label}
      </Text>
      <Text
        className={
          danger
            ? "text-sm font-semibold text-red-600"
            : "text-sm font-medium text-neutral-900"
        }
      >
        {formatBalanceWithSymbol(value, symbol ?? "")}
      </Text>
    </View>
  );
}

function getAddressStatus(value: string): AddressStatus {
  if (value.length === 0) return "empty";
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return "invalid";
  const body = value.slice(2);
  const hasMixedCase =
    body !== body.toLowerCase() && body !== body.toUpperCase();
  if (hasMixedCase && !isValidEvmAddress(value)) return "checksum_warning";
  if (hasMixedCase && toChecksumAddress(hexToBytes(body)) === value)
    return "valid";
  return "valid";
}

function parseAmount(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".")
    return null;
  try {
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

function getAmountError(
  input: string,
  amountWei: bigint | null,
  spendableWei: bigint | null,
): string | null {
  if (input.length === 0) return null;
  if (amountWei === null) return "Enter a valid positive amount";
  if (amountWei <= 0n) return "Amount must be greater than zero";
  if (spendableWei !== null && amountWei > spendableWei) {
    return "Amount exceeds balance after network fee";
  }
  return null;
}

function feeForPreset(
  estimate: GasEstimate,
  preset: GasPreset,
): {
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  estimatedFeeWei: bigint;
} {
  const config =
    GAS_PRESETS.find((item) => item.key === preset) ?? GAS_PRESETS[1];
  const priority = ceilDiv(
    estimate.maxPriorityFeePerGas * (config?.numerator ?? 125n),
    100n,
  );
  const maxFeePerGas = maxBigint(
    estimate.maxFeePerGas,
    estimate.baseFeePerGas * 2n + priority,
  );
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas,
    gasLimit: estimate.gasLimit,
    estimatedFeeWei: estimate.gasLimit * maxFeePerGas,
  };
}

function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}
