import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Stage 6b biometric UX layer.
 *
 * This module exists for **pre-flight capability checks** only. The actual
 * authentication for mnemonic reveal is performed by iOS when the native
 * module invokes `SecKeyCreateDecryptedData` on the Secure-Enclave key —
 * that call is what drops the Face ID / Touch ID / passcode sheet.
 *
 * We DO NOT call `LocalAuthentication.authenticateAsync` from JS: doing so
 * before the native SE operation would produce a second, redundant prompt
 * (and the LA prompt does not actually gate the SE key — only iOS itself
 * does that).
 */

export type BiometricType = 'face' | 'fingerprint' | 'none';

export interface BiometricCapability {
  /** Hardware (Secure Enclave + biometric sensor) is present on the device. */
  available: boolean;
  /** At least one biometric identity is enrolled in the OS. */
  enrolled: boolean;
  /** Best-effort label for UX copy ("Use Face ID" vs "Use Touch ID"). */
  type: BiometricType;
}

/**
 * Best-effort device capability probe used to tailor onboarding copy and
 * decide whether to block wallet creation pending biometric enrollment.
 *
 * Every call path is wrapped in a try/catch — the `expo-local-authentication`
 * APIs can throw on simulator / hardware edge cases and we never want the
 * probe itself to break onboarding.
 */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  const [available, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync().catch(() => false),
    LocalAuthentication.isEnrolledAsync().catch(() => false),
    LocalAuthentication.supportedAuthenticationTypesAsync().catch(
      () => [] as LocalAuthentication.AuthenticationType[],
    ),
  ]);

  let type: BiometricType = 'none';
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    type = 'face';
  } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    type = 'fingerprint';
  }

  return { available, enrolled, type };
}

/** Human-readable label for the biometric sheet / copy. */
export function biometricLabel(type: BiometricType): string {
  switch (type) {
    case 'face':
      return 'Face ID';
    case 'fingerprint':
      return 'Touch ID';
    case 'none':
      return 'biometrics';
  }
}
