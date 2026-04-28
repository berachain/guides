import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "./styles";

interface RenameAccountDialogProps {
  visible: boolean;
  currentName: string;
  onSave: (newName: string) => void;
  onCancel: () => void;
}

export function RenameAccountDialog({
  visible,
  currentName,
  onSave,
  onCancel,
}: RenameAccountDialogProps): React.JSX.Element {
  const [input, setInput] = useState(currentName);

  useEffect(() => {
    if (visible) setInput(currentName);
  }, [currentName, visible]);

  const trimmed = input.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 32;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-md gap-4 rounded-2xl bg-white p-5">
          <Text className="text-lg font-semibold text-neutral-900">
            Rename account
          </Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Account name"
            placeholderTextColor="#a3a3a3"
            autoCapitalize="sentences"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            textContentType="none"
            maxLength={64}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base text-neutral-900"
          />
          <Text
            className={
              trimmed.length > 32
                ? "text-sm text-red-600"
                : "text-sm text-neutral-500"
            }
          >
            {trimmed.length} / 32
          </Text>
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
                disabled={!canSave}
                onPress={() => {
                  onSave(input);
                }}
                className={canSave ? PRIMARY_BUTTON : PRIMARY_BUTTON_DISABLED}
              >
                <Text className={PRIMARY_BUTTON_TEXT}>Save</Text>
              </Pressable>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onSave("");
            }}
            className="items-center py-2"
          >
            <Text className="text-sm font-medium text-neutral-500">
              Reset to default
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
