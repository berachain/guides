import { Stack } from "expo-router";

export default function OnboardingLayout(): React.JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: "Back",
        headerTitleAlign: "center",
        headerStyle: { backgroundColor: "#ffffff" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#ffffff" },
      }}
    >
      <Stack.Screen name="generate" options={{ title: "Create a wallet" }} />
      <Stack.Screen
        name="reveal"
        options={{
          title: "Your Recovery Phrase",
          gestureEnabled: false,
          headerBackVisible: false,
        }}
      />
      <Stack.Screen name="confirm" options={{ title: "Backup options" }} />
      <Stack.Screen
        name="warning"
        options={{
          title: "Important",
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="restore"
        options={{
          title: "Restore from iCloud",
          gestureEnabled: false,
          headerBackVisible: false,
        }}
      />
    </Stack>
  );
}
