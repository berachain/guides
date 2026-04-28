import { Pressable, Text, View } from "react-native";

export interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
}

export function Checkbox({
  checked,
  onToggle,
  label,
}: CheckboxProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      className="flex-row items-center gap-3 py-2"
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-md border ${
          checked
            ? "border-neutral-900 bg-neutral-900"
            : "border-neutral-300 bg-white"
        }`}
      >
        {checked ? (
          <Text className="text-xs font-bold text-white">✓</Text>
        ) : null}
      </View>
      <Text className="flex-1 text-base leading-5 text-neutral-800">
        {label}
      </Text>
    </Pressable>
  );
}
