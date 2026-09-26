# Georgian streaming STT

Status: implemented behind a server switch; **legacy remains the default**. The final physical-phone and Georgian listening evaluation is owned by the user. Do not infer recognition quality from automated tests or silence probes.

## Requirements and boundaries

- Expo Go, physical Android and iPhone; latest installed OS/Expo Go requested by the user. Record exact versions in the private device report.
- Georgian spoken words remain intact. No LLM rewriting, audio trimming, or whole-recording upload in the new foreground path.
- Capture mono PCM16LE at 16 kHz in 100 ms packets. Stateful area resampling carries fractional sample boundaries across hardware callbacks and averages channels. Format changes fail visibly instead of corrupting speech.
- One controller per utterance owns capture, socket, timers, and cleanup. States: connecting, listening, finalizing, idle, error. New utterances use new sockets and identifiers.
- Start only after authentication/provider readiness. The UI remains connecting until capture starts; speech before listening is not captured.
- Eight seconds without initial provider-detected speech, 60 seconds maximum, five seconds to finalize. The timer and Finish/Keep listening buttons are visible while listening. Keep listening disables automatic completion for that utterance, but not the duration cap.
- Two seconds of unacknowledged PCM is the client queue ceiling. RN does not maintain `bufferedAmount`, so the gateway acknowledges cumulative audio bytes. Never silently drop an overloaded queue.
- Provider segments accumulate into one turn. Only final, complete text reaches `runAssistantTurn`. Cancel, error, background, interruption, and disconnect discard pending results. The orb stops the session; successful answers re-arm listening.
- Translator, background native capture, AI, and TTS retain their existing endpoints and implementations. Wake-word improvements, barge-in, and redesign remain out of scope.

## Code map and contract

`web/src/stt/protocol.ts` is the single shared type contract, imported with `import type` by mobile (erased by Metro; no backend runtime code is bundled).

`/api/stt/config` returns the authenticated user's rollout flag with `Cache-Control: no-store`. `/api/stt/stream` is a WebSocket handled by the standalone gateway, not a Next.js upgrade handler. First control message: `start`, protocol version, bearer token, session/utterance IDs, PCM format. Then binary PCM frames, `keep_listening`, `finish`, or `cancel`. Server replies include `ready`, `audio_ack`, `partial`, `segment`, `endpoint`, `final`, and structured `error`. Every control/response carries IDs. An endpoint asks the client to stop capture, flush its short tail, and send Finish; it cannot execute a command itself.

ElevenLabs uses Scribe v2 Realtime, Georgian, VAD with 1.2 seconds silence, verbatim behavior, and timestamps. Hard provider segments alone do not end a turn: timestamped trailing silence is required. Finalization drains through an empty explicit commit so an outstanding nonempty VAD result is not mistaken for the final audio boundary. If drain acknowledgement fails or is throttled, the utterance fails closed after five seconds. This sequencing and provider timestamp behavior still need real spoken-audio evaluation, particularly near simultaneous VAD/Finish and at provider hard segment boundaries.

Google uses Chirp 3 with interim results and voice activity events. End-of-speech starts a 1.2 second pause window, canceled by speech resuming. Finish half-closes the gRPC request; only response stream end completes the turn. Selecting Google requires explicit project, region, ADC credentials, and `STT_GOOGLE_PREVIEW_VERIFIED=true` after a successful account/region probe.

Capture interruption status and missing native buffers release the microphone. Hardware route format changes fail visibly. OS calls, same-format headphone changes, and native callback tail delivery require physical-device checks; there is no claim that JS mocks prove native audio behavior.

## Local setup

From `web`, install dependencies with `npm ci`. Copy the STT settings from `.env.example` into your private environment. Next and the gateway must use the same `JWT_SECRET` and rollout settings. Start a persistent Redis, set `REDIS_URL`, then `npm run dev:all`.

For phone testing, run `caddy run --config Caddyfile.dev` from `web`. It exposes port 3000, routes `/api/stt/stream` to 3001 and all other paths to Next at 3002. Point the mobile API base URL at the host's LAN address on port 3000, or use the deployed HTTPS origin. A phone pointed directly at Next port 3002 cannot upgrade to the separate gateway. For Android USB development, reverse the proxy port as well as Metro's port. Start mobile with `npm start` inside `mobile`; the declared SDK is 57 and expo-audio is 57.0.5.

## Deployment and rollback

1. Set `STT_ENABLED=false` initially. Configure `JWT_SECRET`, provider credentials, and Google project/region if applicable. Set `STT_TEST_USERS` to comma-separated authenticated user IDs for staged evaluation.
2. From `web`, run `docker compose up -d --build`. Compose runs Next, the gateway, persistent Redis with AOF and `appendfsync always`, and Caddy. Only Caddy exposes public ports. Gateway health checks require Redis to respond.
3. Enable allowlisted testing with `STT_ENABLED=true`, `STT_ROLLOUT=allowlist`. Recreate **both app and stt** after changing rollout/provider environment. Provider choice is immutable within an utterance.
4. Public rollout requires the evaluation and device gates below; then set `STT_ROLLOUT=all`.
5. Roll back with `STT_ENABLED=false` and `docker compose up -d --force-recreate app stt`. This disconnects in-flight streaming turns without sending them to AI. The next start reads the flag and uses legacy HTTP STT. A 404 config response also supports older servers; transport/auth/config errors surface visibly rather than replaying the same speech through another provider.

Keep `STT_TRUST_PROXY=true` only behind the private Caddy network. Caddy supplies the client IP; do not publish gateway port 3001 directly with proxy trust enabled. Redis is internal and has no published port in production.

Default limits: one concurrent stream per account, ten globally, 900 seconds/account/day, 7200 seconds/global/day, 20 authenticated starts/account/minute, 30 upgrades/IP/minute. Account/global daily and concurrent limits are configurable in `.env.example`. A connection reserves 70 seconds atomically before any paid upstream opens; clean closure refunds unused whole seconds. A crash conservatively retains the full reservation. Concurrency leases expire after 75 seconds, longer than the hard connection lifetime. Counters use UTC dates, pinned at admission across midnight, retained for two days. Near the daily limit, less than 70 seconds of remaining budget cannot admit another stream. Do not delete the Redis volume during deployment.

Operational logs contain provider, outcome/error code, connection duration, audio duration, time from provider readiness to first partial, Finish-to-final duration, and reference-price estimated USD. They do not contain audio, transcripts, tokens, account IDs, or raw provider errors. The readiness-to-partial metric is **not** the speech-onset latency acceptance metric. Actual billed USD remains null until reconciled with account exports; do not treat estimates or conservative reservations as invoice totals. Provider-side retention follows the account contract; excluding content from our logs does not enable ElevenLabs enterprise zero retention.

## Automated verification

- `cd mobile; npm test -- --runInBand` and `npx tsc --noEmit`
- `cd web; npm run test:stt` and `npx tsc --noEmit`
- Set `STT_TEST_REDIS_URL` to an **isolated** Redis for real Redis concurrency/persistence tests; otherwise that integration test is explicitly skipped. The test creates `stt:*` keys, so never point it at production.
- `npm run stt:probe -- --stream` checks ElevenLabs connection/commit with 2.5 seconds of silence and Google's location metadata, then a bounded silence request when Georgian Chirp 3 is listed. The probe prints only status/capabilities. It makes paid requests only with `--stream`; no speech or user content is sent.
- Build `Dockerfile.stt`; verify `/healthz`, Caddy upgrade routing, and Redis persistence before deployment.

## User-owned final evaluation

Copy `manifest.template.json` to an ignored `stt-evaluation-private` directory. It contains 60 planned human utterances (30 per phone) plus silence/noise-only fixtures for each phone. They are **templates, not recordings**. The first 15 prompts on each phone are tuning; the other 15 are held out. Keep the same split across phones to avoid leaking held-out wording into tuning. Review the Georgian prompt/reference wording before recording; transcribe what was actually spoken, including corrections and fillers.

Record ordinary requests, names, numbers, English app names inside Georgian, quiet speech, reproducible noise, natural pauses, and long sentences. Extend the long examples naturally to 25–40 seconds; include one 60-second limit exercise separately. Capture native phone microphones in Expo Go during app testing. For provider replay, export identical source recordings as mono PCM16 WAV at 16 kHz (or raw `.pcm`); do not independently record each provider's input. Preserve untrimmed beginnings/ends. Mark `humanRecorded=true` only after recording. Annotate `speechStartMs`/`speechEndMs` from the actual waveform, and record model, OS version, Expo Go version, native rate, route, Wi-Fi conditions, and ambient conditions in your private report.

The replay tool only invokes STT, never the assistant or actions. Set `STT_EVAL_BASE_URL` to the test origin and `STT_EVAL_TOKEN` to a test account bearer token. Keep both out of shell history where possible.

```text
npm run stt:evaluate -- replay ../stt-evaluation-private/manifest.json ../stt-evaluation-private/results.jsonl legacy 10
npm run stt:evaluate -- replay ../stt-evaluation-private/manifest.json ../stt-evaluation-private/results.jsonl elevenlabs 10
npm run stt:evaluate -- replay ../stt-evaluation-private/manifest.json ../stt-evaluation-private/results.jsonl google 10
npm run stt:evaluate -- score ../stt-evaluation-private/manifest.json ../stt-evaluation-private/results.jsonl
```

Select the streaming provider **on the server** before its replay; the tool rejects a mismatch. Default replay limit is ten utterances, maximum 60, and at most 15 minutes of audio/run. Run tuning manifests separately, then freeze settings and use a held-out manifest. The scorer needs the complete original manifest and all corresponding results. Include the four silence fixtures in a separate replay or a manifest subset (64 total fixtures exceed the per-run cap). Result rows store source hashes, text, latency, coverage, and errors in the ignored directory. Latest result for each provider/ID is scored; preserve earlier runs separately for audit. Reconcile actual billed USD separately using provider usage exports; null means unknown.

Acceptance: held-out quiet WER <=10%, noisy WER <=20%, no overall WER regression against legacy, critical names/numbers >=95%; first-partial p95 <=1000 ms from annotated speech onset and final p95 <=2500 ms from speech end, including pause time. Silence/noise-only fixtures must produce no final text. Failed/missing results count against acceptance. Identical audio hashes, a complete human dataset, and all device gates are required. Within one percentage point WER prefer lower final latency, then lower billed cost when available; unknown bills do not establish a cost winner. No candidate passing means retain legacy.

Device checklist on **both** phones: rapid start/stop and start while a previous stop settles; permission denied/re-enabled; incoming call; wired/Bluetooth route changes; background/lock during connecting/listening/finalizing; network loss; provider rejection; expired auth; exhausted quota; pauses shorter and longer than 1.2 seconds; Keep listening; Finish during a pending segment; silence/noise-only; audible beginning and ending; >20-second capture; 60-second finish; one assistant request per turn; none after cancel/error; re-listen after Mia finishes speaking. Use harmless requests for command-count checks.

Only after observing these, set these `deviceGates` fields true in the private manifest: `androidExpoGo`, `iphoneExpoGo`, `permissions`, `calls`, `headphones`, `background`, `networkLoss`, `noLostAudio`, `longUtterance`, `noDuplicateCommands`, `noPostCancelCommands`. Leave untested fields absent/false. Public STT readiness is not an audit of authentication, AI actions, or the rest of the application.

## Source references

- [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/) and the installed SDK's `AudioStream.types.ts`/native implementation.
- [ElevenLabs realtime API](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime), [event reference](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference), [pricing](https://elevenlabs.io/pricing/api).
- [Google Chirp 3](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3), [pricing](https://cloud.google.com/speech-to-text/pricing).

Reference cost constants checked 2026-09-26: ElevenLabs realtime $0.39/hour and Google standard V2 $0.016/minute. Subscription allowances and Google credits require separate account verification.
