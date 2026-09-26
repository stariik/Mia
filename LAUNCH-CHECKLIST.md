# Mia — Play Store Launch Checklist (manual items)

Everything code-side from the audit is committed. These are the items only you
can do, in order of dependency. Estimated total effort: one focused day, plus
Play review time (typically 1–7 days for a new developer account).

---

## 1. Deploy the backend — ✅ **DONE 2026-07-16**

Live at **https://api.miavoice.online** — Hetzner CX22 (Falkenstein), Docker,
Caddy with auto-renewing Let's Encrypt. Runbook: `DEPLOY.md`.

Verified from outside: `/`, `/privacy`, `/delete-account` → 200 with valid TLS;
`POST /api/chat` → 401 (the auth guard working, not an error).

- [x] Single persistent instance (VPS, not serverless) — required by the
      in-memory rate limiter and the JSON-file user store.
- [x] Env set on the server (`web/.env`, scp'd — never in git).
- [x] `PROD_API_BASE_URL` set in `mobile/src/config/env.ts`.
- [ ] **Smoke-test from the tablet on mobile data: register → voice turn → alarm.**
      Production starts with zero accounts; the local `users.json` stays local.

## 1b. Backend follow-ups (not launch blockers)

- [ ] Back up `web/google-service-account.json` — like the keystore, it exists
      only on your laptop and that server. No recovery if both are lost.
- [ ] Back up the accounts volume periodically (`DEPLOY.md` → Back up).
- [ ] Renew watch: `.online` renewals run ~10x the first-year promo. The domain
      is compiled into shipped apps — if it lapses, every install breaks and
      only an app update can fix it. Keep auto-renew on and a live card.

## 2. Keystore — back it up NOW

- [ ] `mobile/android/app/upload-keystore.jks` + `mobile/android/keystore.properties`
      were generated for you and are **gitignored — they exist only on this
      machine**. Copy both to a password manager / secure cloud storage today.
- [ ] Enroll in **Play App Signing** during first upload (default). Google then
      holds the signing key and a lost upload key can be reset with a support
      request — this is your safety net.

## 3. Sentry (recommended before launch, 15 min)

- [x] Create a project at sentry.io → copy the DSN into
      `mobile/src/config/env.ts` → `PROD_SENTRY_DSN`. The SDK is already
      wired (JS + native + headless tasks); it's a no-op until the DSN is set.
- [ ] `mobile/android/sentry.properties` holds the sentry-cli auth token and is
      gitignored, so a fresh clone must recreate it. It has to live under
      `android/` — the Gradle plugin searches the module and the Gradle root,
      never the RN root, so a copy at `mobile/sentry.properties` alone fails the
      release build with "Auth token is required" at
      `uploadSentryProguardMappingsRelease`. Without a token, build with
      `-x uploadSentryProguardMappingsRelease -x sentryUploadSourceBundleRelease`;
      the APK is identical, only crash symbolication is skipped.
- [ ] Screenshots and `send-default-pii` are deliberately OFF in
      `AndroidManifest.xml` — turning either on sends conversation text or IP
      off-device and contradicts the Data Safety answers in §5 below.

## 4. Privacy policy (required — the mic permission makes this non-optional)

- [ ] Host a privacy policy at a public URL (can be a page on the same domain
      as the backend). It must state, truthfully (verified against the code):
      - Voice recordings are captured only while you actively use the mic and
        are sent over HTTPS to Mia's server, which forwards them to Google
        (speech recognition). The transcribed text is processed by Google
        Gemini (assistant replies, translation, transcript correction); replies are synthesized via
        ElevenLabs. Only Google ever receives audio. **Recordings are not
        stored** on Mia's servers.
      - Conversations are stored **only on your device**.
      - Account data: email address + hashed password. Deletable in-app
        (Settings → ანგარიშის წაშლა) or at `https://<your-domain>/delete-account`.
      - Approximate location (if granted) is used for weather only.
      - The "Hey Mia" wake word runs entirely on-device; no audio leaves the
        phone until it triggers.
- [ ] Paste the URL in Play Console → App content → Privacy policy.

## 5. Data Safety form (Play Console → App content) — pre-filled answers

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** |
| **Voice or sound recordings** | Collected. NOT shared for advertising; shared with a service provider (Google, speech recognition) for app functionality — Gemini/ElevenLabs receive text only, never audio. **Not stored** (processed ephemerally). Collection is required for core functionality. Encrypted in transit. Not deletable (nothing is retained). |
| **Email address** | Collected, for account management. Not shared. Stored. Encrypted in transit. **Deletable** (in-app + web URL). |
| **Approximate location** | Collected (optional), app functionality (weather). Not shared beyond the weather provider. Not stored. |
| **Messages (chat text)** | Processed for functionality; transcripts stored on-device only → answer "not collected" per Play's definition (never leaves ephemeral processing / device). |
| Data encrypted in transit? | Yes (HTTPS enforced by network security config) |
| Account deletion URL | `https://<your-domain>/delete-account` |
| Account creation | Yes — email + password |

## 6. Store listing

- [ ] Confirm final **applicationId `ge.mia.app`** (set in
      `mobile/android/app/build.gradle`) — **permanent after first upload**.
      Change it now or never.
- [ ] App name: **Mia — ხმოვანი ასისტენტი** (or similar; "Mia" alone is
      likely taken).
- [ ] Screenshots: min 2, phone 16:9/9:16 — capture Home (orb), a conversation,
      Translator, Alarms. Feature graphic 1024×500 required.
- [ ] 512 px icon: already generated at `mobile/playstore-icon-512.png`.
- [ ] Short + full description in Georgian (primary locale `ka-GE`) and English.
- [ ] Content rating questionnaire: no UGC shown publicly, no ads → likely
      "Everyone".
- [ ] App category: Productivity (or Tools).
- [ ] Declare **sensitive permissions** in App content → the form asks about
      `USE_FULL_SCREEN_INTENT` (alarms) and the foreground-service microphone
      type (wake word). Both have legitimate, user-visible justifications —
      describe the alarm ring screen and the opt-in "Hey Mia" toggle.

## 7. Build & upload

```powershell
cd mobile/android
./gradlew bundleRelease
# output: app/build/outputs/bundle/release/app-release.aab
```

- [ ] Upload to a **Closed testing** track first; test on a real device
      installed from Play (App Signing re-signs it — verify the first run,
      mic permission, one full voice turn, one alarm).
- [ ] Then promote to Production.

## 8. Decisions I deliberately left to you

- **Production backend host** (§1) — cost/ops choice.
- **applicationId** — I chose `ge.mia.app`; permanent, so veto now if you
  disagree.
- **The web demo page** (`web/src/app/page.tsx`) has been calling guarded
  routes without auth since June — it 401s and is effectively dead. Decide:
  wire it to the login API, or take the page down when you deploy (the
  `/delete-account` page must stay public either way).
- **Paid API budget**: `DAILY_REQUEST_CAP=5000` global default ≈ roughly
  1000 voice turns/day worst-case. Set to what your wallet tolerates.
- **32-bit support**: kept arm64-only. Adding `armeabi-v7a` breaks the
  `react-native-nitro-sound` native build on Windows (ninja "manifest still
  dirty" loop — a known third-party issue your gradle.properties comment
  already flagged). arm64 reaches ~all recent phones; if you want 32-bit
  reach later, try the build on a Linux CI runner.

## Post-launch backlog (from the audit; none block launch)

1. Native audio focus handling (duck music / pause on call) — small Kotlin module.
2. Move TTS playback out of the WebView (nitro-sound + drive orb from levels).
3. Streaming STT (already on your roadmap — biggest latency win remaining).
4. Server: users → SQLite/Postgres, rate limiter → Redis when >1 instance.
5. Recording cap: >20 s speech is silently truncated (`pcmCapture.ts`).
6. "Report a bad response" affordance + basic analytics on turn failures.
