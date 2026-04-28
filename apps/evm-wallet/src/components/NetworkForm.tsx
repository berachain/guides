import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NetworkInput } from "@/lib/networks/validation";
import { validateNetworkInput } from "@/lib/networks/validation";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_DISABLED,
  PRIMARY_BUTTON_TEXT,
  SCREEN_PADDING,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_TEXT,
} from "./styles";

export interface NetworkFormOutput {
  name: string;
  rpcUrl: string;
  chainId: number;
  currencySymbol: string;
  blockExplorerUrl?: string;
}

interface NetworkFormProps {
  initialValues?: Partial<NetworkInput>;
  submitLabel: string;
  onSubmit: (input: NetworkFormOutput) => void;
  onCancel: () => void;
}

const EMPTY_INPUT: NetworkInput = {
  name: "",
  rpcUrl: "",
  chainId: "",
  currencySymbol: "",
  blockExplorerUrl: "",
};

export function NetworkForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
}: NetworkFormProps): React.JSX.Element {
  const initial = useMemo(
    () => ({ ...EMPTY_INPUT, ...initialValues }),
    [initialValues],
  );
  const [input, setInput] = useState<NetworkInput>(initial);
  const [touched, setTouched] = useState(false);
  const result = validateNetworkInput(input);
  const requiredFilled =
    input.name.trim().length > 0 &&
    input.rpcUrl.trim().length > 0 &&
    input.chainId.trim().length > 0 &&
    input.currencySymbol.trim().length > 0;

  const update = (key: keyof NetworkInput, value: string): void => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const submit = (): void => {
    setTouched(true);
    const validation = validateNetworkInput(input);
    if (!validation.valid) {
      Alert.alert(
        "Fix network details",
        "Please fix the highlighted fields and try again.",
      );
      return;
    }
    onSubmit({
      name: input.name.trim(),
      rpcUrl: input.rpcUrl.trim(),
      chainId: Number(input.chainId.trim()),
      currencySymbol: input.currencySymbol.trim(),
      blockExplorerUrl: input.blockExplorerUrl.trim() || undefined,
    });
  };

  const dirty = JSON.stringify(input) !== JSON.stringify(initial);
  const cancel = (): void => {
    if (!dirty) {
      onCancel();
      return;
    }
    Alert.alert("Discard changes?", "Your network changes will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onCancel },
    ]);
  };

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName={`${SCREEN_PADDING} gap-4`}
    >
      <Field
        label="Network name"
        value={input.name}
        placeholder="Ethereum Mainnet"
        onBlur={() => setTouched(true)}
        onChangeText={(value) => update("name", value)}
        error={touched ? result.errors.name : undefined}
      />
      <Field
        label="RPC URL"
        value={input.rpcUrl}
        placeholder="https://eth.llamarpc.com"
        keyboardType="url"
        autoCapitalize="none"
        onBlur={() => setTouched(true)}
        onChangeText={(value) => update("rpcUrl", value)}
        error={touched ? result.errors.rpcUrl : undefined}
        warning={touched ? result.warnings.rpcUrl : undefined}
      />
      <Field
        label="Chain ID"
        value={input.chainId}
        placeholder="1"
        keyboardType="number-pad"
        autoCapitalize="none"
        onBlur={() => setTouched(true)}
        onChangeText={(value) => update("chainId", value)}
        error={touched ? result.errors.chainId : undefined}
      />
      <Field
        label="Currency symbol"
        value={input.currencySymbol}
        placeholder="ETH"
        autoCapitalize="characters"
        maxLength={6}
        onBlur={() => setTouched(true)}
        onChangeText={(value) => update("currencySymbol", value.toUpperCase())}
        error={touched ? result.errors.currencySymbol : undefined}
      />
      <Field
        label="Block explorer URL (optional)"
        value={input.blockExplorerUrl}
        placeholder="https://etherscan.io"
        keyboardType="url"
        autoCapitalize="none"
        onBlur={() => setTouched(true)}
        onChangeText={(value) => update("blockExplorerUrl", value)}
        error={touched ? result.errors.blockExplorerUrl : undefined}
        warning={touched ? result.warnings.blockExplorerUrl : undefined}
      />

      <View className="mt-2 gap-3">
        <Pressable
          accessibilityRole="button"
          disabled={!requiredFilled}
          onPress={submit}
          className={requiredFilled ? PRIMARY_BUTTON : PRIMARY_BUTTON_DISABLED}
        >
          <Text className={PRIMARY_BUTTON_TEXT}>{submitLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={cancel}
          className={SECONDARY_BUTTON}
        >
          <Text className={SECONDARY_BUTTON_TEXT}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onBlur: () => void;
  error?: string;
  warning?: string;
  keyboardType?: "default" | "url" | "number-pad";
  autoCapitalize?: "none" | "words" | "characters";
  maxLength?: number;
}

function Field({
  label,
  value,
  placeholder,
  onChangeText,
  onBlur,
  error,
  warning,
  keyboardType = "default",
  autoCapitalize = "words",
  maxLength,
}: FieldProps): React.JSX.Element {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-neutral-700">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor="#a3a3a3"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        textContentType="none"
        maxLength={maxLength}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base text-neutral-900"
      />
      {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
      {!error && warning ? (
        <Text className="text-sm text-amber-700">{warning}</Text>
      ) : null}
    </View>
  );
}
