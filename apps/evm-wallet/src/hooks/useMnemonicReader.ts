import { useCallback } from "react";
import { readMnemonic } from "@/lib/storage/secure";

export type MnemonicReader = (id: string) => Promise<string | null>;

/**
 * Returns a stable reader for a wallet's mnemonic from the iOS Keychain.
 *
 * As of Stage 6 the Keychain item is addressed by id alone — the native
 * module matches both synced and local variants in a single query — so
 * callers no longer need to thread the `icloudBackedUp` flag through.
 *
 * Future stages (biometric prompts, `AppState` checks, rate limiting) can
 * wrap the call here without touching the consumer screens.
 */
export function useMnemonicReader(): MnemonicReader {
  return useCallback(async (id: string) => {
    return readMnemonic(id);
  }, []);
}
