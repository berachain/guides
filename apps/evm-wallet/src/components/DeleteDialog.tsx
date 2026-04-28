import { useCallback, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import {
  DESTRUCTIVE_BUTTON,
  DESTRUCTIVE_BUTTON_DISABLED,
  DESTRUCTIVE_BUTTON_TEXT,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "./styles";

export const DELETE_CONFIRM_PHRASE = "I want to delete this";

export interface DeleteDialogProps {
  visible: boolean;
  walletLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteDialog({
  visible,
  walletLabel,
  onCancel,
  onConfirm,
}: DeleteDialogProps): React.JSX.Element {
  const [input, setInput] = useState("");
  const canConfirm = input.trim() === DELETE_CONFIRM_PHRASE;

  const handleCancel = useCallback((): void => {
    setInput("");
    onCancel();
  }, [onCancel]);

  const handleConfirm = useCallback((): void => {
    onConfirm();
    setInput("");
  }, [onConfirm]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-md gap-4 rounded-2xl bg-white p-5">
          <Text className="text-lg font-semibold text-neutral-900">
            Delete {walletLabel}?
          </Text>
          <Text className="text-sm leading-5 text-neutral-700">
            This will permanently delete this recovery phrase from the app. If
            you didn't write it down, your wallet will be lost forever.
          </Text>
          <Text className="text-sm text-neutral-600">
            Type{" "}
            <Text className="font-mono text-neutral-900">
              {DELETE_CONFIRM_PHRASE}
            </Text>{" "}
            below to confirm:
          </Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={DELETE_CONFIRM_PHRASE}
            placeholderTextColor="#a3a3a3"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            textContentType="none"
            keyboardType="default"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base text-neutral-900"
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Pressable
                accessibilityRole="button"
                onPress={handleCancel}
                className={SECONDARY_BUTTON}
              >
                <Text className={SECONDARY_BUTTON_TEXT}>Cancel</Text>
              </Pressable>
            </View>
            <View className="flex-1">
              <Pressable
                accessibilityRole="button"
                disabled={!canConfirm}
                onPress={handleConfirm}
                className={
                  canConfirm ? DESTRUCTIVE_BUTTON : DESTRUCTIVE_BUTTON_DISABLED
                }
              >
                <Text className={DESTRUCTIVE_BUTTON_TEXT}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
