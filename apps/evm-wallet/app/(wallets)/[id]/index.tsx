import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import { AccountRow } from "@/components/AccountRow";
import { BalanceSkeleton } from "@/components/BalanceSkeleton";
import { DeleteDialog } from "@/components/DeleteDialog";
import { RenameAccountDialog } from "@/components/RenameAccountDialog";
import {
  DESTRUCTIVE_BUTTON,
  DESTRUCTIVE_BUTTON_TEXT,
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "@/components/styles";
import { categorizeBalanceError, useBalance } from "@/hooks/useBalance";
import { buildExplorerAddressUrl } from "@/lib/blockExplorer";
import { BALANCE_STALE_TIME_MS } from "@/lib/query/client";
import { WalletCryptoError } from "@/lib/storage/secure";
import { getActiveNetwork, useNetworksStore } from "@/lib/stores/networks";
import {
  getHiddenAccounts,
  getVisibleAccounts,
  useWalletsStore,
} from "@/lib/stores/wallets";
import {
  getAccountDisplayName,
  type Network,
  type WalletAccount,
} from "@/lib/types";

interface RenameTarget {
  index: number;
  currentName: string;
}

export default function WalletDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const wallet = useWalletsStore((s) => s.wallets.find((w) => w.id === id));
  const networks = useNetworksStore((s) => s.networks);
  const activeNetworkId = useNetworksStore((s) => s.activeNetworkId);
  const addAccount = useWalletsStore((s) => s.addAccount);
  const restorePendingAccount = useWalletsStore((s) => s.restorePendingAccount);
  const setAccountHidden = useWalletsStore((s) => s.setAccountHidden);
  const setAccountName = useWalletsStore((s) => s.setAccountName);
  const setPrimaryAccount = useWalletsStore((s) => s.setPrimaryAccount);
  const deleteWallet = useWalletsStore((s) => s.deleteWallet);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const activeNetwork = getActiveNetwork(networks, activeNetworkId);

  useFocusEffect(
    useCallback(() => {
      void queryClient.refetchQueries({
        queryKey: ["balance"],
        type: "active",
        predicate: (query) =>
          Date.now() - query.state.dataUpdatedAt > BALANCE_STALE_TIME_MS,
      });
    }, [queryClient]),
  );

  const visibleAccounts = useMemo(
    () => (wallet ? getVisibleAccounts(wallet) : []),
    [wallet],
  );
  const hiddenAccounts = useMemo(
    () => (wallet ? getHiddenAccounts(wallet) : []),
    [wallet],
  );

  const createdLabel = useMemo(
    () =>
      wallet
        ? new Date(wallet.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "",
    [wallet],
  );

  const copyAddress = useCallback(async (address: string): Promise<void> => {
    await Clipboard.setStringAsync(address);
    Alert.alert("Address copied", address);
  }, []);

  const handleAddAccount = useCallback(async (): Promise<void> => {
    if (!wallet) return;
    setBusy(true);
    try {
      await addAccount(wallet.id);
    } catch (err) {
      if (err instanceof WalletCryptoError && err.code === "USER_CANCELED") {
        Alert.alert("Authentication canceled", "No account was added.");
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Could not add account", message);
    } finally {
      setBusy(false);
    }
  }, [addAccount, wallet]);

  const handleRestorePending = useCallback(
    async (accountIndex: number): Promise<void> => {
      if (!wallet) return;
      setBusy(true);
      try {
        await restorePendingAccount(wallet.id, accountIndex);
      } catch (err) {
        if (err instanceof WalletCryptoError && err.code === "USER_CANCELED") {
          Alert.alert("Authentication canceled", "No account was restored.");
          return;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        Alert.alert("Could not restore account", message);
      } finally {
        setBusy(false);
      }
    },
    [restorePendingAccount, wallet],
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!wallet) return;
    setDeleteDialogVisible(false);
    try {
      await deleteWallet(wallet.id);
      router.replace("/(wallets)");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Failed to delete", message);
    }
  }, [deleteWallet, router, wallet]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const renderAccount = useCallback(
    ({ item }: { item: WalletAccount }): React.JSX.Element => (
      <AccountRowWithBalance
        account={item}
        isPrimary={wallet?.primaryAccountIndex === item.index}
        isHidden={item.hidden}
        activeNetwork={activeNetwork}
        onCopyAddress={() => {
          void copyAddress(item.address);
        }}
        onRename={() => {
          setRenameTarget({
            index: item.index,
            currentName: getAccountDisplayName(item),
          });
        }}
        onToggleHidden={() => {
          if (!wallet) return;
          void setAccountHidden(wallet.id, item.index, !item.hidden).catch(
            (err) => {
              const message =
                err instanceof Error ? err.message : "Unknown error";
              Alert.alert("Could not update account", message);
            },
          );
        }}
        onSetPrimary={
          wallet?.primaryAccountIndex === item.index || item.hidden
            ? undefined
            : () => {
                if (!wallet) return;
                void setPrimaryAccount(wallet.id, item.index).catch((err) => {
                  const message =
                    err instanceof Error ? err.message : "Unknown error";
                  Alert.alert("Could not set primary", message);
                });
              }
        }
        onSend={
          item.hidden
            ? undefined
            : () => {
                if (!wallet) return;
                router.push({
                  pathname: "/(wallets)/[id]/send/[accountIndex]",
                  params: { id: wallet.id, accountIndex: String(item.index) },
                } as never);
              }
        }
      />
    ),
    [
      activeNetwork,
      copyAddress,
      router,
      setAccountHidden,
      setPrimaryAccount,
      wallet,
    ],
  );

  if (!wallet) {
    return (
      <View
        className={`flex-1 items-center justify-center bg-white ${SCREEN_PADDING}`}
      >
        <Text className="text-base text-neutral-500">Wallet not found.</Text>
      </View>
    );
  }

  const pendingIndices = wallet.pendingAccountIndices ?? [];

  return (
    <View className="flex-1 bg-white">
      <Stack.Screen
        options={{
          title: wallet.label,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh balances"
              disabled={refreshing}
              hitSlop={12}
              onPress={() => {
                void handleRefresh();
              }}
            >
              <Text className="text-xl text-neutral-900">
                {refreshing ? "⟳" : "↻"}
              </Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={visibleAccounts}
        keyExtractor={(account) => String(account.index)}
        renderItem={renderAccount}
        contentContainerClassName={`${SCREEN_PADDING} gap-3`}
        refreshing={refreshing}
        onRefresh={() => {
          void handleRefresh();
        }}
        ListHeaderComponent={
          <View className="gap-4">
            <View className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <Text className="text-lg font-semibold text-neutral-900">
                {wallet.label}
              </Text>
              <Text className="mt-2 text-sm text-neutral-600">
                Created {createdLabel}
              </Text>
              <Text className="mt-1 text-sm text-neutral-600">
                {wallet.icloudBackedUp
                  ? "Backed up to iCloud Keychain"
                  : "Local only"}
              </Text>
              <Text className="mt-1 text-xs text-neutral-500">
                Backup status is set at wallet creation.
              </Text>
              <Text className="mt-3 text-sm text-neutral-700">
                {visibleAccounts.length} visible account
                {visibleAccounts.length === 1 ? "" : "s"}
                {hiddenAccounts.length > 0
                  ? ` (${hiddenAccounts.length} hidden)`
                  : ""}
              </Text>
            </View>
            {pendingIndices.length > 0 ? (
              <View className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <Text className="text-sm font-semibold text-amber-950">
                  {pendingIndices.length} account
                  {pendingIndices.length === 1 ? "" : "s"} pending restore
                </Text>
                <Text className="mt-1 text-sm leading-5 text-amber-900">
                  This wallet had additional accounts in your backup. Restore
                  them one at a time when you need them.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    void handleRestorePending(pendingIndices[0] ?? 0);
                  }}
                  className={`mt-3 ${busy ? PRIMARY_BUTTON_DISABLED : PRIMARY_BUTTON}`}
                >
                  {busy ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className={PRIMARY_BUTTON_TEXT}>
                      Restore next account
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}
            <Text className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Accounts
            </Text>
          </View>
        }
        ListFooterComponent={
          <View className="gap-3">
            {hiddenAccounts.length > 0 ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setShowHidden((value) => !value);
                  }}
                  className={SECONDARY_BUTTON}
                >
                  <Text className={SECONDARY_BUTTON_TEXT}>
                    {showHidden
                      ? "Hide hidden accounts"
                      : "Show hidden accounts"}
                  </Text>
                </Pressable>
                {showHidden ? (
                  <View className="gap-3">
                    <Text className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                      Hidden
                    </Text>
                    {hiddenAccounts.map((account) => (
                      <View key={account.index}>
                        {renderAccount({ item: account })}
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                void handleAddAccount();
              }}
              className={busy ? PRIMARY_BUTTON_DISABLED : PRIMARY_BUTTON}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text className={PRIMARY_BUTTON_TEXT}>Add account</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeleteDialogVisible(true);
              }}
              className={DESTRUCTIVE_BUTTON}
            >
              <Text className={DESTRUCTIVE_BUTTON_TEXT}>Delete wallet</Text>
            </Pressable>
          </View>
        }
      />
      <RenameAccountDialog
        visible={renameTarget !== null}
        currentName={renameTarget?.currentName ?? ""}
        onCancel={() => {
          setRenameTarget(null);
        }}
        onSave={(newName) => {
          if (renameTarget === null) return;
          void setAccountName(wallet.id, renameTarget.index, newName)
            .then(() => {
              setRenameTarget(null);
            })
            .catch((err) => {
              const message =
                err instanceof Error ? err.message : "Unknown error";
              Alert.alert("Could not rename account", message);
            });
        }}
      />
      <DeleteDialog
        visible={deleteDialogVisible}
        walletLabel={wallet.label}
        onCancel={() => {
          setDeleteDialogVisible(false);
        }}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </View>
  );
}

interface AccountRowWithBalanceProps {
  account: WalletAccount;
  isPrimary: boolean;
  isHidden: boolean;
  activeNetwork: Network | null;
  onCopyAddress: () => void;
  onRename: () => void;
  onToggleHidden: () => void;
  onSetPrimary?: () => void;
  onSend?: () => void;
}

function AccountRowWithBalance({
  account,
  isPrimary,
  isHidden,
  activeNetwork,
  onCopyAddress,
  onRename,
  onToggleHidden,
  onSetPrimary,
  onSend,
}: AccountRowWithBalanceProps): React.JSX.Element {
  const balance = useBalance(account.address, activeNetwork?.id);
  const sendDisabled =
    !activeNetwork ||
    balance.isPending ||
    balance.isFetching ||
    balance.isError ||
    (balance.data?.value ?? 0n) === 0n;
  return (
    <AccountRow
      account={account}
      isPrimary={isPrimary}
      isHidden={isHidden}
      onCopyAddress={onCopyAddress}
      onRename={onRename}
      onToggleHidden={onToggleHidden}
      onSetPrimary={onSetPrimary}
      onSend={onSend}
      sendDisabled={sendDisabled}
      onOpenExplorer={
        activeNetwork?.blockExplorerUrl
          ? () => {
              void Linking.openURL(
                buildExplorerAddressUrl(
                  activeNetwork.blockExplorerUrl ?? "",
                  account.address,
                ),
              );
            }
          : undefined
      }
      balanceSlot={
        <AccountBalanceLine balance={balance} network={activeNetwork} />
      }
    />
  );
}

function AccountBalanceLine({
  balance,
  network,
}: {
  balance: ReturnType<typeof useBalance>;
  network: Network | null;
}): React.JSX.Element {
  if (!network)
    return (
      <Text className="text-xs text-neutral-500">
        Balance: — · Add a network
      </Text>
    );
  if (balance.isPending || balance.isFetching) return <BalanceSkeleton />;
  if (balance.error) {
    const error = categorizeBalanceError(balance.error);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          Alert.alert("Balance unavailable", error.message, [
            { text: "Cancel", style: "cancel" },
            { text: "Retry", onPress: () => void balance.refetch() },
          ]);
        }}
      >
        <Text className="text-xs text-red-600">
          ● Balance unavailable · tap to retry
        </Text>
      </Pressable>
    );
  }
  return (
    <Text className="text-xs font-medium text-neutral-700">
      Balance: {balance.data?.formatted ?? "—"} {network.currencySymbol}
    </Text>
  );
}
