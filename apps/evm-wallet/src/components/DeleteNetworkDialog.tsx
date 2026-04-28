import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import type { Network } from "@/lib/types";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_TEXT,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "./styles";

interface DeleteNetworkDialogProps {
  network: Network | null;
  onCancel: () => void;
  onConfirm: (network: Network) => void;
}

export function DeleteNetworkDialog({
  network,
  onCancel,
  onConfirm,
}: DeleteNetworkDialogProps): React.JSX.Element {
  const [input, setInput] = useState("");
  const phrase = network ? `Delete ${network.name}` : "";
  const canConfirm = input.trim() === phrase;

  useEffect(() => {
    if (network !== null) setInput("");
  }, [network]);

  return (
    <Modal
      visible={network !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-md gap-4 rounded-2xl bg-white p-5">
          <Text className="text-lg font-semibold text-neutral-900">
            Delete {network?.name}?
          </Text>
          <Text className="text-sm leading-5 text-neutral-700">
            This removes the RPC configuration from this device.
          </Text>
          <Text className="text-sm text-neutral-600">
            Type <Text className="font-mono text-neutral-900">{phrase}</Text>{" "}
            below to confirm:
          </Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={phrase}
            placeholderTextColor="#a3a3a3"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            textContentType="none"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base text-neutral-900"
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Pressable
                accessibilityRole="button"
                onPress={onCancel}
                className={SECONDARY_BUTTON}
              >
                <Text className={SECONDARY_BUTTON_TEXT}>Cancel</Text>
              </Pressable>
            </View>
            <View className="flex-1">
              <Pressable
                accessibilityRole="button"
                disabled={!canConfirm || network === null}
                onPress={() => {
                  if (network) onConfirm(network);
                }}
                className={canConfirm ? PRIMARY_BUTTON : SECONDARY_BUTTON}
              >
                <Text
                  className={
                    canConfirm ? PRIMARY_BUTTON_TEXT : SECONDARY_BUTTON_TEXT
                  }
                >
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
