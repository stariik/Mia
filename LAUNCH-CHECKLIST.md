# Mia — Play Store Launch Checklist (manual items)

Everything code-side from the audit is committed. These are the items only you
can do, in order of dependency. Estimated total effort: one focused day, plus
Play review time (typically 1–7 days for a new developer account).

---

## 1. Deploy the backend — **THE blocker; nothing works without it**

The app is a thin client: chat, STT, TTS, translation and auth all live in
`web/`. It currently runs only on your laptop.

- [ ] Pick hosting for the Next.js app. Needs: Node runtime, streaming
      responses (SSE), and a stable HTTPS domain.
      Note: the in-memory rate limiter (`web/src/lib/apiGuard.ts`) and the
      JSON-file user store (`web/data/users.json`) assume a **single,
      persistent instance** — a VPS (Hetzner/DigitalOcean, ~$6/mo) fits this
      best. Serverless (Vercel) would silently break both (cold instances =
      no rate limit state; read-only FS = registration fails). If you choose
      Vercel anyway, move users to a DB and the limiter to Upstash first.
- [ ] Set environment variables on the server:
      - `JWT_SECRET` — long random string (server now refuses to start in
        production without it): `openssl rand -base64 48`
      - `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `CAMB_API_KEY`,
        Google STT credentials (same set as your local `.env`)
      - `DAILY_REQUEST_CAP` — optional; default 5000 requests/day globally
- [ ] Put the HTTPS URL into `mobile/src/config/env.ts` → `PROD_API_BASE_URL`.
      Release builds show a Georgian "server not configured" error until you do.
- [ ] Smoke-test from a phone on mobile data: register → voice turn → alarm.

## 2. Keystore — back it up NOW

- [ ] `mobile/android/app/upload-keystore.jks` + `mobile/android/keystore.properties`
      were generated for you and are **gitignored — they exist only on this
      machine**. Copy both to a password manager / secure cloud storage today.
- [ ] Enroll in **Play App Signing** during first upload (default). Google then
      holds the signing key and a lost upload key can be reset with a support
      request — this is your safety net.

## 3. Sentry (recommended before launch, 15 min)

- [ ] Create a project at sentry.io → copy the DSN into
      `mobile/src/config/env.ts` → `PROD_SENTRY_DSN`. The SDK is already
      wired (JS + native + headless tasks); it's a no-op until the DSN is set.

## 4. Privacy policy (required — the mic permission makes this non-optional)

- [ ] Host a privacy policy at a public URL (can be a page on the same domain
      as the backend). It must state, truthfully (verified against the code):
      - Voice recordings are captured only while you actively use the mic and
        are sent over HTTPS to Mia's server, which forwards them to Google
        (speech recognition) and OpenAI (fallback recognition); replies are
        synthesized via ElevenLabs/Camb/OpenAI. **Recordings are not stored**
        on Mia's servers.
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
| **Voice or sound recordings** | Collected. NOT shared for advertising; shared with service providers (Google/OpenAI/ElevenLabs) for app functionality. **Not stored** (processed ephemerally). Collection is required for core functionality. Encrypted in transit. Not deletable (nothing is retained). |
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
- **32-bit support**: I enabled `armeabi-v7a`. If closed testing shows a
  problem on 32-bit devices, you can revert to arm64-only in
  `mobile/android/gradle.properties` (Play allows it; it just shrinks reach).

## Post-launch backlog (from the audit; none block launch)

1. Native audio focus handling (duck music / pause on call) — small Kotlin module.
2. Move TTS playback out of the WebView (nitro-sound + drive orb from levels).
3. Streaming STT (already on your roadmap — biggest latency win remaining).
4. Server: users → SQLite/Postgres, rate limiter → Redis when >1 instance.
5. Recording cap: >20 s speech is silently truncated (`pcmCapture.ts`).
6. "Report a bad response" affordance + basic analytics on turn failures.
