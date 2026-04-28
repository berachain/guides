import { Stack, useRouter } from "expo-router";
import { Alert } from "react-native";
import { NetworkForm, type NetworkFormOutput } from "@/components/NetworkForm";
import { useNetworksStore } from "@/lib/stores/networks";

export default function NewNetwork(): React.JSX.Element {
  const router = useRouter();
  const addNetwork = useNetworksStore((s) => s.addNetwork);

  const submit = (input: NetworkFormOutput): void => {
    try {
      addNetwork(input);
      router.replace("/(settings)/networks" as never);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Could not add network", message);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Add Network" }} />
      <NetworkForm
        submitLabel="Add Network"
        onSubmit={submit}
        onCancel={() => router.back()}
      />
    </>
  );
}
