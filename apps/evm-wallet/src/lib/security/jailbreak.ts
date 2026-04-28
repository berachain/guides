import JailMonkey from 'jail-monkey';
import type { SecurityWarning } from '../types';

/**
 * Heuristic device-compromise checks via `jail-monkey`.
 *
 * These are advisory — they detect common jailbreak/root/hooking artifacts
 * but a determined attacker can bypass any of them. We surface results as a
 * non-dismissible banner and never gate functionality on the outcome.
 */

export function isJailbroken(): boolean {
  try {
    return JailMonkey.isJailBroken();
  } catch {
    return false;
  }
}

export async function isDebugged(): Promise<boolean> {
  try {
    return await JailMonkey.isDebuggedMode();
  } catch {
    return false;
  }
}

export function hasHookingFrameworks(): boolean {
  try {
    return JailMonkey.hookDetected();
  } catch {
    return false;
  }
}

export async function runSecurityChecks(): Promise<SecurityWarning> {
  const [jailbroken, debugged, hooked] = await Promise.all([
    Promise.resolve(isJailbroken()),
    isDebugged(),
    Promise.resolve(hasHookingFrameworks()),
  ]);
  return { jailbroken, debugged, hooked };
}
