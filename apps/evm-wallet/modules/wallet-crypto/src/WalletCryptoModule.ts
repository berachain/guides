import { NativeModule, requireNativeModule } from "expo";

/**
 * Low-level typed handle to the native `WalletCrypto` Expo module.
 *
 * Do not import this directly from app code — use the wrappers in
 * `./index.ts`, which pin down error handling, parameter shapes, and the
 * security boundary (the only method that returns plaintext is
 * `revealMnemonic`).
 */
declare class WalletCryptoModule extends NativeModule {
  isRunningOnSimulator?: () => boolean;
  generateAndStoreMnemonic(icloudBackedUp: boolean): Promise<string>;
  /**
   * `prompt` is shown in the Face ID / Touch ID / passcode sheet when the
   * wallet is stored in the Secure-Enclave-wrapped path. Ignored for
   * iCloud-backed and pre-Stage-6b local wallets (no biometric prompt).
   */
  revealMnemonic(id: string, prompt?: string): Promise<string>;
  deriveSeedFromMnemonic(id: string, prompt: string): Promise<string>;
  deleteMnemonic(id: string): Promise<void>;
  mnemonicExists(id: string): Promise<boolean>;
  /**
   * `prompt` is used only when transitioning local → iCloud (which has to
   * unwrap the AES key); it is unused for iCloud → local and no-op cases.
   */
  setMnemonicSyncState(
    id: string,
    icloudBackedUp: boolean,
    prompt?: string,
  ): Promise<void>;
  setSyncStateAndDeriveSeed(
    id: string,
    icloudBackedUp: boolean,
    prompt: string,
  ): Promise<string>;
}

export default requireNativeModule<WalletCryptoModule>("WalletCrypto");
