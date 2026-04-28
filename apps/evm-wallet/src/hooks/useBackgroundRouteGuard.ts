import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

/**
 * When the app transitions to `inactive` or `background`, route away from the
 * current screen to `targetRoute`. Intended for screens that render secrets
 * (the mnemonic reveal screen). The task-switcher snapshot is additionally
 * masked by `BackgroundBlankOverlay`, but redirecting means that when the
 * user foregrounds the app again they land somewhere safe rather than back
 * on the mnemonic.
 */
export function useBackgroundRouteGuard(targetRoute: Href): void {
  const router = useRouter();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "inactive" || nextState === "background") {
        router.replace(targetRoute);
      }
    });
    return () => {
      sub.remove();
    };
  }, [router, targetRoute]);
}
