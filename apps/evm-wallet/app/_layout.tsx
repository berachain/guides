import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { View } from "react-native";
import { BackgroundBlankOverlay } from "@/components/BackgroundBlankOverlay";
import { SecurityWarningBanner } from "@/components/SecurityWarningBanner";
import { SimulatorModeBanner } from "@/components/SimulatorModeBanner";
import queryClient from "@/lib/query/client";
import "../global.css";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <View className="flex-1 bg-white">
        <SimulatorModeBanner />
        <SecurityWarningBanner />
        <Stack screenOptions={{ headerShown: false }} />
        <BackgroundBlankOverlay />
      </View>
    </QueryClientProvider>
  );
}
