# Stage 4 — iCloud Keychain backup test plan

Manual checklist. Run on the iOS Simulator for Tests 1–3 and 5. Test 4 requires two physical devices on the same Apple ID and is optional.

## Environment setup

- Dev client built from Stage 3 (no rebuild should be required for Stage 4 — no new native modules). Confirm by launching `bun run start` and opening the existing dev client on the simulator.
- iCloud Keychain enabled:
  - Simulator: Settings → "Sign in to your Apple Account" → iCloud → Passwords and Keychain → enable. **Note:** simulator iCloud sign-in is finicky on Xcode 15/16; a "successful" sign-in on the simulator does not always produce real sync. If end-to-end sync verification matters, use a physical device (Test 4).
  - Physical device: Settings → [Your Name] → iCloud → Passwords and Keychain → enable.

Before each test: from the Wallets header, long-press the title (2 s) and tap **Reset** to wipe local state.

---

## Test 1 — Create wallet with iCloud toggle ON

1. Open the app.
2. Tap **Generate Recovery Phrase**.
3. Acknowledge the 24-word list on the reveal screen, tap **Continue**.
4. On the confirm screen:
   - Toggle **Back up to iCloud Keychain** to ON.
   - Verify the copy below the toggle reads "Your recovery phrase will be encrypted and synced to your iCloud Keychain…"
   - Verify the persistent trust-model callout above the toggle is visible.
5. Tap **Finish**. Expect:
   - Brief activity indicator on the button.
   - No warning screen.
   - Lands on the wallets list.
6. Verify the new row shows "☁️ iCloud" in its subtitle.
7. Force-quit the app (swipe up from app switcher).
8. Relaunch. Expect the wallet to still be present with the ☁️ indicator.

**Pass criteria:** wallet persists across force-quit, indicator present, no warning screen shown.

---

## Test 2 — Create wallet with iCloud toggle OFF

1. Header **+** → **Generate Recovery Phrase** → acknowledge reveal → **Continue**.
2. On confirm screen, leave toggle OFF. Verify the muted helper text reads "You'll see an important warning on the next screen."
3. Tap **Finish**. Expect to land on the warning screen.
4. Check the acknowledgment checkbox, tap **I understand, continue**.
5. Lands on wallets list. Verify the row has **no** ☁️ indicator.
6. Force-quit and relaunch. Row persists, still no indicator.

**Pass criteria:** warning screen shown, wallet persists without indicator.

---

## Test 3 — Delete a wallet (both synced and local)

1. With one synced and one local wallet in the list:
2. Tap the trash icon on the synced row.
3. In the delete dialog, type `I want to delete this` exactly, tap **Delete**.
4. Row disappears immediately.
5. Force-quit and relaunch. Synced wallet still gone.
6. Repeat for the local wallet.

**Pass criteria:** both delete paths work, no residual Keychain items (verified by relaunch).

_Note:_ iCloud deletion propagation across devices happens asynchronously and cannot be verified in real-time from the app. See Test 4 for cross-device verification.

---

## Test 4 — Cross-device sync (physical devices, optional)

Requires two iOS devices signed into the same Apple ID with iCloud Keychain enabled, both running the dev client.

1. Device A: create wallet with iCloud toggle ON. Record the UUID shown in the wallets list row (you may need to surface it via a temporary debug log — skip this sub-step in shipping builds).
2. Wait 30–60 seconds for iCloud Keychain sync.
3. Device B: install / run the app. Launch, long-press the title to **Reset**, then reinstall the app.
4. Open the native iOS "Passwords" app on Device B. Search for "wallet.mnemonic" — the synced entry should be listed.
5. (Future: a "Restore from iCloud" flow will surface this in-app. See README Known limitations.)

**Pass criteria:** synced Keychain item visible on Device B within ~60 s. Currently the app cannot yet rebuild its MMKV index from this — that is post-MVP work.

---

## Test 5 — Uninstall / reinstall (known limitation)

1. Create at least one wallet with iCloud ON.
2. Delete the app from the simulator (long-press the app icon → Remove App → Delete).
3. Reinstall via `bunx expo run:ios` or by dragging the .app onto the simulator.
4. Launch. Expect the app to show an empty wallets list.

**Pass criteria:** the app does **not** crash, and reaches the onboarding flow. The fact that the wallets list is empty even though the mnemonic is still in the synced Keychain is the documented limitation — see `README.md` → Known limitations. A Stage 4b "Restore from iCloud" flow will close this gap.

---

## Non-functional checks

- `bunx tsc --noEmit` — zero errors.
- `bun run lint` — clean.
- Grep for `Coming soon` and `// TODO Stage 4` in source — zero matches.
- No console logs of mnemonic content, Keychain payloads, or full wallet objects.
