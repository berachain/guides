import { Stack } from "expo-router";

export default function SettingsLayout(): React.JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#ffffff" },
        headerShadowVisible: false,
        headerTitleAlign: "center",
        contentStyle: { backgroundColor: "#ffffff" },
      }}
    />
  );
}
