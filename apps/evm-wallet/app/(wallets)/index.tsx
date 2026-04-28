import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { BalanceSkeleton } from "@/components/BalanceSkeleton";
import { DeleteDialog } from "@/components/DeleteDialog";
import { SCREEN_PADDING } from "@/components/styles";
import { categorizeBalanceError, useBalance } from "@/hooks/useBalance";
import { isValidEvmAddress } from "@/lib/crypto/evm";
import { truncateAddress } from "@/lib/format";
import { BALANCE_STALE_TIME_MS } from "@/lib/query/client";
import { WalletCryptoError } from "@/lib/storage/secure";
import { getActiveNetwork, useNetworksStore } from "@/lib/stores/networks";
import {
  getPrimaryAccount,
  getVisibleAccounts,
  useWalletsStore,
} from "@/lib/stores/wallets";
import {
  getAccountDisplayName,
  type Network,
  type WalletIndexEntry,
} from "@/lib/types";

interface DialogTarget {
  id: string;
  label: string;
}

export default function WalletsList(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wallets = useWalletsStore((s) => s.wallets);
  const networks = useNetworksStore((s) => s.networks);
  const activeNetworkId = useNetworksStore((s) => s.activeNetworkId);
  const setActiveNetwork = useNetworksStore((s) => s.setActiveNetwork);
  const deleteWallet = useWalletsStore((s) => s.deleteWallet);
  const deriveAddressForWallet = useWalletsStore(
    (s) => s.deriveAddressForWallet,
  );
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);
  const [derivingWalletId, setDerivingWalletId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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

  const handleRequestDelete = useCallback((wallet: WalletIndexEntry): void => {
    setDialogTarget({ id: wallet.id, label: wallet.label });
  }, []);

  const handleCancel = useCallback((): void => {
    setDialogTarget(null);
  }, []);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (dialogTarget === null) return;
    const { id } = dialogTarget;
    setDialogTarget(null);
    try {
      await deleteWallet(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Failed to delete", message);
    }
  }, [dialogTarget, deleteWallet]);

  const handleCopy = useCallback(async (address: string): Promise<void> => {
    await Clipboard.setStringAsync(address);
    Alert.alert("Address copied", address);
  }, []);

  const handleDeriveAddress = useCallback(
    async (wallet: WalletIndexEntry): Promise<void> => {
      setDerivingWalletId(wallet.id);
      try {
        await deriveAddressForWallet(wallet.id);
      } catch (err) {
        if (err instanceof WalletCryptoError && err.code === "USER_CANCELED") {
          Alert.alert(
            "Authentication canceled",
            "Authenticate to derive this wallet address.",
          );
          return;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        Alert.alert("Failed to derive address", message);
      } finally {
        setDerivingWalletId(null);
      }
    },
    [deriveAddressForWallet],
  );

  const renderItem = useCallback(
    ({ item }: { item: WalletIndexEntry }): React.JSX.Element => (
      <WalletRow
        wallet={item}
        deriving={derivingWalletId === item.id}
        onCopy={handleCopy}
        onDelete={handleRequestDelete}
        onDeriveAddress={handleDeriveAddress}
        activeNetwork={activeNetwork}
        onOpen={(walletId) => {
          router.push({
            pathname: "/(wallets)/[id]",
            params: { id: walletId },
          } as never);
        }}
      />
    ),
    [
      activeNetwork,
      derivingWalletId,
      handleCopy,
      handleDeriveAddress,
      handleRequestDelete,
      router,
    ],
  );

  const keyExtractor = useCallback((w: WalletIndexEntry): string => w.id, []);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const listEmpty = useMemo<React.JSX.Element>(
    () => (
      <View className="items-center py-24">
        <Text className="text-base text-neutral-500">
          No wallets. Tap + to create one.
        </Text>
      </View>
    ),
    [],
  );

  return (
    <View className="flex-1 bg-white">
      <FlatList
        data={wallets}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerClassName={`${SCREEN_PADDING} gap-3`}
        refreshing={refreshing}
        onRefresh={() => {
          void handleRefresh();
        }}
        ListHeaderComponent={
          <NetworkSwitcher
            activeNetwork={activeNetwork}
            networks={networks}
            onManage={() => {
              router.push("/(settings)/networks" as never);
            }}
            onAdd={() => {
              router.push("/(settings)/networks/new" as never);
            }}
            onSelect={setActiveNetwork}
          />
        }
        ListEmptyComponent={listEmpty}
      />
      <DeleteDialog
        visible={dialogTarget !== null}
        walletLabel={dialogTarget?.label ?? ""}
        onCancel={handleCancel}
        onConfirm={() => {
          void handleConfirm();
        }}
      />
    </View>
  );
}

interface WalletRowProps {
  wallet: WalletIndexEntry;
  deriving: boolean;
  onCopy: (address: string) => void;
  onDelete: (wallet: WalletIndexEntry) => void;
  onDeriveAddress: (wallet: WalletIndexEntry) => void;
  onOpen: (walletId: string) => void;
  activeNetwork: Network | null;
}

function WalletRow({
  wallet,
  deriving,
  onCopy,
  onDelete,
  onDeriveAddress,
  onOpen,
  activeNetwork,
}: WalletRowProps): React.JSX.Element {
  const createdLabel = useMemo<string>(
    () =>
      new Date(wallet.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [wallet.createdAt],
  );
  const primaryAccount = useMemo(() => {
    try {
      return getPrimaryAccount(wallet);
    } catch {
      return null;
    }
  }, [wallet]);
  const balance = useBalance(primaryAccount?.address, activeNetwork?.id);
  const visibleAccountCount = getVisibleAccounts(wallet).length;
  const additionalVisibleCount = Math.max(visibleAccountCount - 1, 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${wallet.label}`}
      onPress={() => {
        onOpen(wallet.id);
      }}
      className="flex-row items-start rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 active:bg-neutral-100"
    >
      <View className="flex-1">
        <Text className="text-base font-semibold text-neutral-900">
          {wallet.label}
        </Text>
        {primaryAccount ? (
          <View className="mt-2 gap-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-medium text-neutral-700">
                {getAccountDisplayName(primaryAccount)}
              </Text>
              {additionalVisibleCount > 0 ? (
                <Text className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700">
                  +{additionalVisibleCount} more
                </Text>
              ) : null}
            </View>
            <View className="flex-row items-center gap-2">
              <Text className="font-mono text-sm text-neutral-700">
                {isValidEvmAddress(primaryAccount.address)
                  ? truncateAddress(primaryAccount.address)
                  : "Invalid address"}
              </Text>
              {isValidEvmAddress(primaryAccount.address) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Copy address for ${wallet.label}`}
                  onPress={() => {
                    onCopy(primaryAccount.address);
                  }}
                  className="rounded-md border border-neutral-300 px-2 py-1 active:bg-neutral-200"
                >
                  <Text className="text-xs text-neutral-700">Copy</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View className="mt-2 flex-row items-center gap-2">
            <Text className="text-sm text-neutral-500">Address pending...</Text>
            <Pressable
              accessibilityRole="button"
              disabled={deriving}
              onPress={() => {
                onDeriveAddress(wallet);
              }}
              className="rounded-md border border-neutral-300 px-2 py-1 active:bg-neutral-200"
            >
              {deriving ? (
                <ActivityIndicator color="#404040" />
              ) : (
                <Text className="text-xs text-neutral-700">Derive address</Text>
              )}
            </Pressable>
          </View>
        )}
        <View className="mt-1 flex-row gap-2">
          <Text className="text-xs text-neutral-500">
            Created {createdLabel}
          </Text>
          {wallet.icloudBackedUp ? (
            <Text
              className="text-xs text-neutral-500"
              accessibilityLabel="Synced to iCloud Keychain"
            >
              · ☁️ iCloud
            </Text>
          ) : null}
        </View>
        <BalanceLine balance={balance} network={activeNetwork} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${wallet.label}`}
        hitSlop={12}
        onPress={() => {
          onDelete(wallet);
        }}
        className="rounded-lg px-3 py-2 active:bg-neutral-200"
      >
        <Text className="text-lg">🗑️</Text>
      </Pressable>
    </Pressable>
  );
}

function BalanceLine({
  balance,
  network,
}: {
  balance: ReturnType<typeof useBalance>;
  network: Network | null;
}): React.JSX.Element {
  if (!network) {
    return (
      <Text className="mt-2 text-xs text-neutral-500">
        Balance: — · Add a network
      </Text>
    );
  }
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
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          Alert.alert("Balance unavailable", error.message, [
            { text: "Cancel", style: "cancel" },
            { text: "Retry", onPress: () => void balance.refetch() },
          ]);
        }}
        className="mt-2"
      >
        <Text className="text-xs text-red-600">
          ● Balance unavailable · tap to retry
        </Text>
      </Pressable>
    );
  }
  return (
    <Text className="mt-2 text-xs font-medium text-neutral-700">
      Balance: {balance.data?.formatted ?? "—"} {network.currencySymbol}
    </Text>
  );
}

interface NetworkSwitcherProps {
  activeNetwork: Network | null;
  networks: Network[];
  onSelect: (id: string) => void;
  onManage: () => void;
  onAdd: () => void;
}

function NetworkSwitcher({
  activeNetwork,
  networks,
  onSelect,
  onManage,
  onAdd,
}: NetworkSwitcherProps): React.JSX.Element {
  const openSheet = (): void => {
    if (networks.length === 0) {
      onAdd();
      return;
    }
    const networkLabels = networks.map((network) =>
      network.id === activeNetwork?.id ? `✓ ${network.name}` : network.name,
    );
    const manageIndex = networkLabels.length;
    const cancelButtonIndex = manageIndex + 1;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Active network",
        options: [...networkLabels, "Manage networks", "Cancel"],
        cancelButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex === cancelButtonIndex) return;
        if (buttonIndex === manageIndex) {
          onManage();
          return;
        }
        const network = networks[buttonIndex];
        if (network) onSelect(network.id);
      },
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openSheet}
      className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 active:bg-neutral-100"
    >
      <Text className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Active network
      </Text>
      <Text className="mt-1 text-base font-semibold text-neutral-900">
        {activeNetwork
          ? `${activeNetwork.name} · ${activeNetwork.currencySymbol}`
          : "No network configured"}
      </Text>
      <Text className="mt-1 text-xs text-neutral-500">
        {activeNetwork ? "Tap to switch networks" : "Tap to add a network"}
      </Text>
    </Pressable>
  );
}
