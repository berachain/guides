import { Alert, Pressable, Text, View } from "react-native";
import { truncateAddress } from "@/lib/format";
import { getAccountDisplayName, type WalletAccount } from "@/lib/types";

interface AccountRowProps {
  account: WalletAccount;
  isPrimary: boolean;
  isHidden: boolean;
  onCopyAddress: () => void;
  onRename: () => void;
  onToggleHidden: () => void;
  onSetPrimary?: () => void;
  balanceSlot?: React.ReactNode;
  onOpenExplorer?: () => void;
  onSend?: () => void;
  sendDisabled?: boolean;
}

export function AccountRow({
  account,
  isPrimary,
  isHidden,
  onCopyAddress,
  onRename,
  onToggleHidden,
  onSetPrimary,
  balanceSlot,
  onOpenExplorer,
  onSend,
  sendDisabled = false,
}: AccountRowProps): React.JSX.Element {
  const openMenu = (): void => {
    const buttons = [
      { text: "Rename", onPress: onRename },
      ...(onSetPrimary !== undefined && !isHidden
        ? [{ text: "Set as primary", onPress: onSetPrimary }]
        : []),
      ...(!isPrimary
        ? [{ text: isHidden ? "Unhide" : "Hide", onPress: onToggleHidden }]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert(
      getAccountDisplayName(account),
      truncateAddress(account.address),
      buttons,
    );
  };

  return (
    <View
      className={`rounded-xl border border-neutral-200 bg-white px-4 py-3 ${
        isHidden ? "opacity-50" : ""
      }`}
    >
      <View className="flex-row items-start">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-neutral-900">
              {getAccountDisplayName(account)}
            </Text>
            {isPrimary ? (
              <Text className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">
                Primary
              </Text>
            ) : null}
          </View>
          <Text className="mt-1 font-mono text-sm text-neutral-600">
            {truncateAddress(account.address)}
          </Text>
          {balanceSlot ? <View className="mt-2">{balanceSlot}</View> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${getAccountDisplayName(account)} address`}
          onPress={onCopyAddress}
          className="rounded-md border border-neutral-300 px-2 py-1 active:bg-neutral-100"
        >
          <Text className="text-xs text-neutral-700">Copy</Text>
        </Pressable>
        {onOpenExplorer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${getAccountDisplayName(account)} in explorer`}
            onPress={onOpenExplorer}
            className="ml-2 rounded-md border border-neutral-300 px-2 py-1 active:bg-neutral-100"
          >
            <Text className="text-xs text-neutral-700">↗</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Account actions for ${getAccountDisplayName(account)}`}
          onPress={openMenu}
          className="ml-2 rounded-md px-2 py-1 active:bg-neutral-100"
        >
          <Text className="text-lg text-neutral-700">...</Text>
        </Pressable>
      </View>
      {onSend ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send from ${getAccountDisplayName(account)}`}
          disabled={sendDisabled}
          onPress={onSend}
          className={`mt-4 items-center rounded-xl px-4 py-3 ${
            sendDisabled
              ? "bg-neutral-200"
              : "bg-neutral-900 active:bg-neutral-800"
          }`}
        >
          <Text
            className={`text-base font-semibold ${sendDisabled ? "text-neutral-500" : "text-white"}`}
          >
            Send
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
