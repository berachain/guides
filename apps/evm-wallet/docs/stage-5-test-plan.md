# Stage 5 — Test plan

Manual checklist for the cancel flow, iCloud restore, and security hardening work. Run after rebuilding the dev client (new native modules: `expo-screen-capture`, `jail-monkey`).

## Environment setup

1. Rebuild the dev client:
   ```bash
   eas build -p ios --profile development-simulator --local
   ```
   Install the resulting `.app` on the simulator.
2. `bun run start` to serve the JS bundle.
3. iCloud Keychain enabled (Settings → [Your Name] → iCloud → Passwords and Keychain). The simulator's iCloud sign-in is flaky; use a physical device for end-to-end sync (Test 6).
4. Before each functional test, long-press the Wallets header for 2 seconds and tap **Reset** to wipe local state. (Manifest is cleared by this too.)

---

## Cancel flow

### Test 1a — Cancel on reveal

1. With at least one existing wallet: header **+** → generate → reveal.
2. Tap **Cancel** in the header.
3. Confirm dialog appears: "Discard this recovery phrase? This action cannot be undone."
4. Tap **Keep**. Dialog dismisses, still on reveal screen.
5. Tap **Cancel** again → **Discard**. Routes to wallets list.
6. Tap **+** again → generate → reveal. Verify words differ from the discarded mnemonic (fresh entropy).

### Test 1b — Cancel on confirm

1. Generate → reveal → acknowledge → continue → confirm screen.
2. Tap **Cancel** in header → **Discard**. Routes to wallets list.

### Test 1c — Cancel on warning

1. Generate → reveal → acknowledge → continue → confirm (toggle OFF) → Finish → warning screen.
2. Tap **Cancel** in header. Confirm message reads "Your recovery phrase will be permanently discarded and cannot be recovered."
3. Tap **Discard**. Routes to wallets list.

### Test 1d — Cancel hidden on first-launch generate

1. Reset state. App should land on generate (or restore if a manifest is present — if so, tap "Start fresh instead").
2. Verify the generate screen has **no** Cancel in the header (there's nothing to cancel back to yet).
3. Generate → reveal → Cancel → Discard. Because no wallets exist, routes back to generate (empty state), not the wallets list.

### Test 2 — Back-gesture interception

1. On reveal: attempt swipe-back. Expected: no swipe because `gestureEnabled: false`.
2. On confirm: attempt swipe-back. Expected: `usePreventRemove` triggers the discard dialog.
3. On warning: attempt swipe-back. Expected: gesture disabled, but hardware-back on a physical device triggers the discard dialog.

### Test 3 — Force-quit mid-flow

1. Generate → reach reveal → force-quit the app (swipe up in app switcher).
2. Relaunch. Expected: routes to wallets list (if any exist) or restore (if a manifest exists) or generate. Never lands on reveal with ghost state.
3. Start a new generate flow. Verify words differ from the force-quit mnemonic.

---

## iCloud restore

### Test 4 — Fresh install restore

1. Create a wallet with iCloud toggle ON. Verify the ☁️ iCloud indicator in the list.
2. Delete the app from the simulator (long-press icon → Remove App → Delete).
3. Reinstall via `bunx expo run:ios` or drag the `.app` onto the simulator.
4. Launch. Expected: loading screen → **Restore from iCloud** screen with the wallet listed (label, date, ☁️ iCloud).
5. Tap **Restore wallets**. Spinner briefly shows. Routes to the wallets list.
6. Wallet is present, ☁️ iCloud indicator, correct label and creation date.

### Test 5 — Restore skip keeps manifest

1. From the restore screen (after a prior restore setup), tap **Start fresh instead**.
2. Confirm dialog: "This will ignore your iCloud backup and start with a new wallet…"
3. Tap **Start fresh**. Routes to generate.
4. Force-quit, reinstall. Expected: the restore screen reappears — the manifest was NOT deleted.

### Test 6 — Cross-device sync (physical devices, optional)

1. Device A (signed into Apple ID X, iCloud Keychain on): create wallet with iCloud ON.
2. Wait 30–60 seconds.
3. Device B (same Apple ID, iCloud Keychain on): install the dev client, launch. Expected: restore screen shows the wallet from Device A. Tap restore.
4. Both devices now have the same wallet label and ID. Deleting on one device propagates via iCloud Keychain to the other within ~1 minute (not verifiable in real-time from the app, but verifiable by inspecting the native iOS Passwords app for `wallet.mnemonic.<uuid>` entries).

### Test 7 — Corrupted manifest safety

1. Difficult to reproduce without tooling. If achievable (e.g., by writing a known-bad payload via a debug utility), confirm that the loading screen routes to generate rather than crashing.
2. Confirm there is no mnemonic or manifest content in console logs.

---

## Screen capture and app-state

### Test 8 — Reveal screenshot blocking

1. On the reveal screen, attempt a screenshot (simulator: File → Save Screen, or Cmd+S).
2. Expected on iOS: screenshot is captured as a black image; system may show a privacy notice.
3. Attempt screen recording. Recording of the reveal screen shows a black frame.

### Test 9 — Background blank overlay

1. On any screen (wallets list, reveal, confirm), switch to the app switcher (simulator: Cmd+Shift+H twice).
2. Expected: the app's thumbnail in the switcher shows the blank overlay color (white), not the actual screen content.
3. Foreground the app. Normal content reappears.

### Test 10 — Reveal route-guard on background

1. On the reveal screen, background the app (Cmd+Shift+H on simulator).
2. Foreground the app. Expected: you land on the wallets list (if wallets exist) or generate (if not) — not back on the reveal screen.

---

## Jailbreak advisory

### Test 11 — Banner visibility

1. On a jailbroken device (or a debugger-attached session), launch the app.
2. Expected: a red banner across the top of every screen: "This device appears to be jailbroken or modified. Storing significant value on this device is not recommended."
3. Tap the banner. An alert shows the specific checks that triggered (jailbreak / debugger / hook).
4. Banner persists across navigation; there is no dismiss action.
5. On a clean device, the banner is absent.

Note: `jail-monkey` heuristics occasionally false-positive on simulators or in unusual configurations. Document any false positives but don't gate the test on them.

---

## Input hygiene

### Test 12 — Delete dialog keyboard

1. On the wallets list, tap delete on any wallet.
2. Focus the confirm input. Expected: no "Suggested" autofill bar, no autocorrect, no spell check underline.
3. Type `I want to delete this`. Only the exact (trim-equal) string enables the Delete button.

---

## Non-functional

- `bunx tsc --noEmit` — 0 errors
- `bun run lint` — clean
- `rg -n "console\.(log|info|debug)" src app` — zero matches against mnemonic/manifest/Keychain payloads (warnings of ids / error strings are fine)
- `rg -n "TODO Stage 5|Coming soon"` — zero matches in source
- `pendingMnemonic` never appears in MMKV (inspect `storage.getAllKeys()` via a debug utility or verify by reading `mmkv.ts` — only `wallet_index` and `next_label_number` are written)
