# Mia — Target Specification (Phase 2)

**This file is the contract.** Every file, dependency, and line in the final app must justify its existence against this spec. Derived from the code's evident intent, the roadmap (time/alarms, music, weather as core; Play Store launch), and the launch checklist.

---

## 1. What Mia is

A **Georgian-language voice assistant for Android**, distributed on the Play Store. The user speaks Georgian; Mia answers out loud in natural, colloquial Georgian, and can act on the phone: alarms, timers, music transport, weather, time, arithmetic, and two-way interpreting. One backend (Next.js API on `api.miavoice.online`) proxies all paid AI services so no key ships in the APK.

## 2. The complete user journey

### First run
1. Cold start → branded splash → **AuthScreen** (email + password; register or login; errors in Georgian).
2. On success → **HomeScreen**: aurora backdrop, the orb, greeting-free idle state, 4 suggestion chips (weather / timer / alarm / music) teaching the core capabilities, bottom toolbar (Translator · Timers · Alarms · Settings), history button top-left, keyboard toggle top-right.
3. First orb tap → mic permission prompt (Georgian rationale). Notification permission asked once at boot.

### A voice turn (the product's core loop)
1. Tap orb (or say "Mia" if wake word is on, or tap a chip, or type).
2. Orb → *listening*; live amplitude drives the orb; VAD auto-stops after ~0.75 s silence (7 s grace if nothing said).
3. Orb → *thinking* ("Transcribing…" → streamed reply text appears as chat bubbles).
4. Orb → *speaking* the moment first audio is audible; reply is spoken sentence-by-sentence with no mid-reply gap.
5. Any tap during thinking/speaking **interrupts instantly** and starts listening again.
6. Errors surface as a dismissible Georgian toast; the pipeline always returns to idle.

### Acting on the phone
- "დამიყენე ტაიმერი ხუთ წუთზე" → timer scheduled (notifee + AlarmManager), visible/cancelable in TimersScreen, fires as a notification even if the app is killed. "გააუქმე ტაიმერი" cancels by voice (by id from injected context; all=true for all; asks which when ambiguous).
- "გამაღვიძე ხვალ რვაზე" → one-shot alarm; fires full-screen over the lock screen with snooze (9 min)/dismiss; survives reboot (BootReceiver re-arm); recurring alarms manageable in AlarmsScreen (weekday picker).
- "გააჩერე / გააგრძელე / შემდეგი / წინა / თავიდან" → media-key transport controlling whatever app is playing. Mia **cannot search or launch music** and says so.
- "რა ამინდია?" → weather for detected city (coarse location, reverse-geocoded) or manually set city; asks which city if unknown.
- Time/date questions and arithmetic answered via tools — never hallucinated.

### Hands-free ("Hey Mia")
- Opt-in toggle in Settings (mic FGS + optional overlay permission).
- App closed, screen on/unlocked: "Mia" → floating orb appears → greeting → multi-turn conversation → ends on goodbye/tap/silence → orb animates away, detection re-arms.
- Screen off/locked: single voice-only turn.
- App open: "Mia" behaves exactly like tapping the orb.
- Survives service restarts; recovers via watchdogs; opening the app re-arms after reboot.

### Interpreter
- TranslatorScreen: Georgian ⇄ Russian/English. Tap your language's mic, speak, auto-stop; transcript + translation shown; translation spoken aloud; replay per turn; clear-all.

### History & settings
- Conversation drawer: past conversations (capped at 30), switch/new/delete.
- Settings sheet: wake-word toggle, manual city override + location refresh, sign out, **permanent account deletion** (Play requirement, password-confirmed).

## 3. Capability list (MUST have)

**Client**
- C1. Push-to-talk PCM capture @16 kHz with VAD auto-stop and live level for the orb.
- C2. STT via server Chirp 2 (single-language ka; bilingual mode for the interpreter).
- C3. Streaming chat turn: SSE, sentence-split TTS pipelining, instant interrupt, turn supersession.
- C4. TTS playback that starts on first byte in the in-app orb (MediaSource) with a file-based fallback; file-based playback for headless/translator contexts.
- C5. Orb visualization with 4 states driven by real audio.
- C6. Timers + alarms: schedule/cancel/snooze/dismiss/recur, killed-app and reboot survival, full-screen ring, reconciliation on launch.
- C7. Music transport via media-key events (pause/resume/toggle/next/prev/restart) — nothing more.
- C8. Wake word "Mia" on-device (openWakeWord), FGS lifecycle, app-closed session per journey above.
- C9. Interpreter ka⇄ru/en.
- C10. Auth (register/login/logout/delete), JWT attached to all paid calls, 401 handled with a path back to login.
- C11. Location: coarse permission, reverse-geocoded city, manual override, **never** an automatic re-prompt loop (keyboard-focus invariant).
- C12. Georgian-localized errors for every failure class (offline, STT, chat stall, TTS, 401, 429, mic denied).
- C13. Text input as an alternative to voice.
- C14. Crash reporting active in release (Sentry with a real DSN) — currently unmet.

**Backend**
- B1. `/api/chat` — gpt-4o SSE + tool loop (time, weather, calculate server-side; timer/alarm/music client-side).
- B2. `/api/transcribe-google-v2` — Chirp 2 with normalize/trim/phrase-boost + confidence-gated proofread.
- B3. `/api/synthesize-elevenlabs` — eleven_v3, streamed + `?complete=1` shapes.
- B4. `/api/translate` — gpt-4o.
- B5. `/api/auth/*` — register/login/delete; scrypt; HS256 JWT (30 d).
- B6. Guard on every paid route: token + per-user rate limit + global daily cap.
- B7. `/privacy` and `/delete-account` public pages (Play requirements); root page as health check.

## 4. Explicitly MUST NOT have
- No music search/launch (`play_music`, `playFromSearch`, provider packages, provider picker) — the assistant's prompt already promises it can't.
- No second STT pipeline (file-recorder → gpt-4o-transcribe). One capture path, one STT provider. If Picovoice ever fails to link, that's a build error, not a runtime branch.
- No iOS code paths, `ios/` builds, or per-weekday iOS trigger logic — Android-only until the roadmap says otherwise.
- No TTS/STT provider selection UI or multi-provider fallbacks — eleven_v3 and Chirp 2 are decisions, recorded in comments.
- No dev/debug screens in the shipped navigator or the tree (MusicDevScreen).
- No dependency that isn't imported (new-app-screen, react-native-permissions) and no config system that isn't wired (react-native-config unless it becomes real).
- No fonts referenced that aren't bundled; no styling outside the theme tokens.
- No ungated `console.*` in release code paths.
- No speculative "platform adapter" surface beyond what the app calls (drop `notify()` etc. until needed).

## 5. Non-functional requirements
- **Cold start:** splash → interactive Home in under ~2.5 s on a mid-range device; splash hides on first frame (already the design).
- **Voice latency:** tap-to-first-audio ≤ ~4 s typical (STT ≤1.5 s trimmed, chat first token ≤1.5 s, TTS first byte ~1.4 s overlapped); no mid-reply gaps; interrupt latency <200 ms. Never regress the streaming-TTS and silence-trim work.
- **Robustness:** every network await has a timeout/watchdog; no code path can leave the orb stuck in thinking/speaking (including WebView death); the pipeline is always recoverable by a tap.
- **Offline:** app opens and navigates offline; alarms/timers fire offline; voice features fail fast with the Georgian offline message.
- **Georgian correctness:** all user-visible text in Georgian (MarkGEO renders it); TTS input normalized (numbers as words, no symbols); replies 1–2 sentences.
- **Battery/respect:** wake-word FGS only when opted in; mic released the moment it isn't needed; no polling loops beyond the 80 ms VAD tick while recording.
- **Play Store readiness:** account deletion in-app + web, privacy policy, data-safety form accuracy, release signing, ProGuard, no debug logging of user content in release.
- **Cost safety:** every paid route guarded; client sends trimmed audio only.
- **Maintainability:** one pattern per concern — persistence (zustand persist), navigation (typed navigator, no `any`), animation (Reanimated only), errors (voiceStore + errorMessages for pipeline; local state for screen-scoped), fonts (theme tokens only), logging (one `__DEV__`-gated logger).
