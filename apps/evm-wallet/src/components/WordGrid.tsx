import { Text, View } from "react-native";

export interface WordGridProps {
  words: string[];
}

export function WordGrid({ words }: WordGridProps): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap -mx-1">
      {words.map((word, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: BIP39 position is the identity — the list is replaced wholesale on regenerate, never reordered, and duplicate words are possible.
        <View key={`${i}-${word}`} className="w-1/2 px-1 py-1">
          <View className="min-h-[44px] flex-row items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
            <Text
              selectable={false}
              className="w-7 text-sm font-medium text-neutral-400"
            >
              {i + 1}.
            </Text>
            <Text
              selectable={false}
              className="flex-1 font-mono text-base text-neutral-900"
            >
              {word}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
