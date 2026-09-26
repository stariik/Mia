# Verification record — 2026-09-26

Branch: `feat/voice-agent-stt`. Streaming remains disabled by default. No provider winner or public readiness claim is established.

| Check | Observed result |
| --- | --- |
| Installed Expo dependencies | SDK 57 / expo-audio 57.0.5; `expo install --check` passed. Existing install exclusions remain. |
| Native API inspection | Installed `AudioStream` exposes PCM buffers with actual sample rate/channel count and interruption status on Android/iOS. |
| Mobile unit/integration tests | 8 suites, **56 tests passed**. Includes existing legacy tests, stateful 16/44.1/48 kHz conversion over >20 seconds, exact tail packets, changing hardware format, cancellation during native startup, stale/duplicate results, permission denial, background cleanup, re-listening, Keep listening, duration cap, finalization timeout, network/interruption failure, and RN transport acknowledgement bounds. |
| Mobile TypeScript | Passed `npx tsc --noEmit`. |
| Android and iOS JavaScript bundles | Both exported successfully with `expo export --platform all`. This is a bundling check, not a physical Expo Go test. |
| Gateway/adapter/evaluation tests | **13 tests passed**, including real Redis integration (not skipped). |
| Concurrency | Ten simulated users simultaneously admitted and sent PCM through the gateway; eleventh rejected. Same-account second stream rejected. Disconnect released resources. |
| Persistence | Daily usage persisted after gateway/client restart; a reduced daily cap still rejected admission. Separate actual Redis container restart preserved its daily seconds counter using AOF. |
| Auth/races | Invalid bearer rejected before paid connection. Account rate limit, quota rejection, and disconnect during pending quota acquisition do not open upstream. |
| Provider normalization | ElevenLabs pending VAD segments cannot themselves finalize; empty commit drains the final input. Hard segments require timestamped pause evidence before endpointing. Google waits for response-stream end after Finish. |
| Backend TypeScript / scoped ESLint | Passed. Mobile scoped lint has no errors; existing-style `void` and async assertion warnings remain. |
| Next.js production build | Passed; `/api/stt/config` appears as a dynamic route. |
| Gateway Docker image | Built successfully. Running image reported healthy; `/healthz` returned HTTP 200. |
| Caddy routing | Local container running the shipped Caddyfile successfully upgraded `/api/stt/stream` and returned the gateway's structured unauthorized response. |
| Compose configuration | `docker compose config --quiet` passed. |
| Diff whitespace | `git diff --check` passed (repository CRLF conversion notices only). |

## Bounded live provider checks

Existing local credentials were loaded without printing their values, account/project identifiers, or transcript content. Only generated silence was sent; existing diagnostic speech files were not used as evaluation consent or as a corpus.

- ElevenLabs Scribe v2 Realtime: authenticated session started; 2.5-second silence stream and final commit/drain completed. Repeated bounded probes remained successful after adapter changes. The account subscription endpoint returned HTTP 401, so subscription tier, realtime allowances, and actual billed usage remain unverified. This is compatible with a restricted key but does not prove the cause of the 401.
- Google location metadata in the existing legacy region `us-central1`: Georgian Chirp 3 was not listed.
- Google location metadata in `eu`: Georgian Chirp 3 was listed; a bounded Georgian streaming request with explicit PCM decoding, interim results, and voice activity events was accepted and completed. This proves configuration access, not spoken Georgian accuracy or latency. Google credits and actual billed usage remain unverified.

Reference estimates are $0.39/hour for ElevenLabs realtime and $0.016/minute for Google V2. Actual billed USD is deliberately unknown/null; no Creator allowance or credit benefit was assumed. Sources and reproduction commands are in [the implementation guide](README.md).

## Remaining user-owned gates

The user explicitly reserved final testing on their phones. Target: latest OS and Expo Go on Android and iPhone; exact installed versions and hardware models have not been measured here.

The 60 speech fixtures and four silence/noise fixtures are **unrecorded templates**. No WER, critical-name/number accuracy, speech-onset latency percentile, final latency percentile, or hardware microphone-quality result has been fabricated. Both platforms' permissions, real calls/headphone changes, native buffer tails, long capture, UI placement, and command counts still require the device checklist.

Particular provider checks: ElevenLabs word timestamps across multiple segments; Finish near a VAD commit; empty-drain acknowledgement/throttling under speech; resuming speech near a 1.2-second pause; Google Preview behavior on real Georgian. Failed or missing gates retain the legacy default.

No production deployment, public rollout, or broad authentication/AI-action audit was performed. Test containers used isolated local ports and synthetic credentials. Opt-in evaluation artifacts and exported mobile bundles remain in the ignored `stt-evaluation-private` directory.

## First iPhone (Expo Go) listening check — 2026-09-26

Informal, 4 utterances, one speaker; not the held-out evaluation.

- iOS `AudioStream` runs `AVAudioSession` in `.measurement` mode (no AGC): speech arrived at ~-45 dBFS (peaks -24…-30), noise ~-75 dBFS. The gateway now applies a streaming boost (`src/stt/gain.ts`, -20 dBFS target, max +24 dB, peak-guarded) before any provider.
- Same audio replayed through each provider: ElevenLabs Scribe v2 Realtime misrecognized key words in all 4 (and capitalizes the first letter with Mtavruli); Google Chirp 3 (`eu`) was near-exact on all 4, and the boost fixed one of its errors; legacy Chirp 2 (no proofread) was between the two.
- Local testing switched to `STT_PROVIDER=google`, `STT_GOOGLE_REGION=eu`. Chirp 3 latency and endpointing on device are not yet measured.
