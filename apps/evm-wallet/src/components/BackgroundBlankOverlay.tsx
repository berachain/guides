import { useEffect, useState } from "react";
import { AppState, type AppStateStatus, View } from "react-native";

/**
 * Full-bleed opaque overlay rendered when the app is `inactive` or
 * `background`. This is what iOS captures as the task-switcher snapshot,
 * which otherwise would include any visible screen content — wallet labels,
 * the mnemonic reveal, delete dialogs, etc.
 *
 * Kept pure-JS (no native view manipulation) so it works across the dev
 * client without extra linking. A native `UIView` overlay installed into
 * the key window would be more robust (e.g. covers native alerts too) —
 * Stage 6 if needed.
 */
export function BackgroundBlankOverlay(): React.JSX.Element | null {
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", setAppState);
    return () => {
      sub.remove();
    };
  }, []);

  if (appState === "active") return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#ffffff",
      }}
    />
  );
}
