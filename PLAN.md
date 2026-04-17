# Georgian Voice AI Assistant — Full Project Plan

## Project Overview
A mobile AI assistant that speaks Georgian (ქართული). Users interact via voice — the AI answers questions, plays music, tells time, sets alarms/timers, and reports weather.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      USER (speaks Georgian)              │
│                            │                             │
│                       ┌────▼────┐                        │
│                       │   MIC   │                        │
│                       └────┬────┘                        │
│                            │ audio blob                  │
├────────────────────────────┼────────────────────────────-┤
│  FRONTEND (Next.js / RN)   │                             │
│                            │ POST /api/transcribe         │
│                            │ POST /api/chat               │
│                            │ POST /api/synthesize         │
├────────────────────────────┼────────────────────────────-┤
│  BACKEND (Next.js API)     │                             │
│                    ┌───────▼────────┐                    │
│                    │  Whisper API   │  (speech → text)    │
│                    └───────┬────────┘                    │
│                            │ Georgian text               │
│                    ┌───────▼────────┐                    │
│                    │  GPT-4o-mini   │  (intent + tools)   │
│                    │  or GPT-4o     │                     │
│                    └──┬────┬────┬──┘                     │
│                       │    │    │                         │
│              ┌────────┘    │    └────────┐                │
│              ▼             ▼             ▼                │
│         [get_time]   [get_weather]  [play_music]         │
│              │             │             │                │
│              └─────┬───────┘             │                │
│                    ▼                     │                │
│            ┌──────────────┐              │                │
│            │  TTS (OpenAI │              │                │
│            │  or Camb.ai) │              │                │
│            └──────┬───────┘              │                │
│                   │ audio                │ action         │
├───────────────────┼──────────────────────┼───────────────┤
│  FRONTEND         │                      │               │
│              ┌────▼────┐          ┌──────▼──────┐        │
│              │ SPEAKER │          │ DEVICE API  │        │
│              └─────────┘          │ (music/alarm)│        │
│                                   └─────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer         | Technology                     | Why                              |
|---------------|--------------------------------|----------------------------------|
| Web Frontend  | Next.js 14+ (App Router), TypeScript | SSR, API routes, React ecosystem |
| Mobile        | React Native CLI, TypeScript   | Cross-platform, native module access |
| STT           | OpenAI Whisper API             | Best Georgian support available  |
| LLM           | GPT-4o-mini (simple) / GPT-4o (complex) | Function calling, cost balance |
| TTS           | Camb.ai → OpenAI TTS | Swappable. Note: Google Cloud TTS has **no Georgian voices** (confirmed 2026-04-17 — voices list returns empty for ka-GE). |
| Weather       | OpenWeatherMap (free tier)     | 1000 calls/day free              |
| Auth (later)  | Firebase Auth                  | Easy, cross-platform             |
| Payments (later) | RevenueCat or Stripe        | Mobile subscription handling     |

## Cost Estimates (per user, per day with ~50 voice interactions)

| Service        | Cost/unit                | Est. daily cost |
|----------------|--------------------------|-----------------|
| Whisper STT    | $0.006/min               | ~$0.03          |
| GPT-4o-mini    | $0.15/1M input tokens    | ~$0.01          |
| GPT-4o         | $2.50/1M input tokens    | ~$0.05 (10% of calls) |
| OpenAI TTS     | $15/1M chars             | ~$0.02          |
| OpenWeatherMap | Free (1000 calls/day)    | $0.00           |
| **Total**      |                          | **~$0.11/day**  |

---

# STEP 1: Web App — Georgian Voice Conversation
**Goal**: Voice pipeline works end-to-end in Georgian via browser.

## Phase 1.0: Pipeline Spike (Validation)
> Quick test before building UI. Proves Georgian works through the full chain.

- [ ] Create `spike/test-pipeline.ts` — a Node.js script that:
  1. Takes a pre-recorded Georgian audio file
  2. Sends to Whisper API → logs transcription
  3. Sends text to GPT-4o with Georgian system prompt → logs response
  4. Sends response to OpenAI TTS → saves output audio file
- [ ] Record/find a short Georgian audio sample for testing
- [ ] Run spike, evaluate quality at each step
- [ ] **DECISION GATE**: If TTS quality is bad, test Camb.ai before proceeding

## Phase 1.1: Project Setup
- [ ] Initialize Next.js 14+ with TypeScript and App Router
- [ ] Install core dependencies: `openai`, `ai` (Vercel AI SDK)
- [ ] Configure environment variables (.env.local)
- [ ] Set up project folder structure
- [ ] Configure ESLint, basic tsconfig

## Phase 1.2: Backend — API Routes
- [ ] `src/lib/openai.ts` — OpenAI client singleton
- [ ] `src/lib/prompts.ts` — Georgian assistant system prompt
- [ ] `src/app/api/transcribe/route.ts` — Whisper STT endpoint
  - Accepts: audio blob (webm/wav)
  - Returns: `{ text: string, language: string }`
- [ ] `src/app/api/chat/route.ts` — LLM chat endpoint with streaming
  - Accepts: `{ message: string, history: Message[] }`
  - Returns: streamed text response
  - Includes function calling setup (tools skeleton for Step 2)
  - Smart routing: short/simple queries → GPT-4o-mini, complex → GPT-4o
- [ ] `src/app/api/synthesize/route.ts` — TTS endpoint
  - Accepts: `{ text: string, voice?: string }`
  - Returns: audio stream (mp3)
  - Swappable provider architecture (OpenAI default, Camb.ai fallback)

## Phase 1.3: Frontend — Voice UI
- [ ] `src/hooks/useVoiceRecorder.ts` — microphone recording hook
  - Uses MediaRecorder API
  - Returns: start(), stop(), audioBlob, isRecording
- [ ] `src/hooks/useVoicePipeline.ts` — full pipeline orchestration
  - Chains: record → transcribe → chat → synthesize → play
  - Handles loading states, errors
  - Manages conversation history
- [ ] `src/components/VoiceButton.tsx` — main interaction button
  - Press-and-hold to record (or toggle mode)
  - Visual states: idle, recording, thinking, speaking
- [ ] `src/components/WaveformVisualizer.tsx` — audio feedback
  - Shows waveform while recording and playing
- [ ] `src/components/ConversationLog.tsx` — message history
  - Shows transcribed user messages and AI responses
  - Useful for debugging Georgian transcription accuracy
- [ ] `src/app/page.tsx` — main page assembling all components
- [ ] Basic styling with Tailwind CSS

## Phase 1.4: Integration & Georgian Tuning
- [ ] End-to-end testing: speak Georgian → get Georgian response
- [ ] Tune system prompt for natural Georgian conversation
- [ ] Test edge cases: mixed Georgian/English, numbers, dates
- [ ] Optimize latency: implement streaming TTS playback
- [ ] Test multiple TTS voices, pick best for Georgian
- [ ] Add error handling and retry logic

---

# STEP 2: React Native Mobile Demo
**Goal**: Phone features (music, clock, weather) work via voice commands.

## Phase 2.1: Mobile Project Setup
- [ ] Initialize React Native CLI project (not Expo)
- [ ] Configure Android build environment
- [ ] Set up TypeScript
- [ ] Configure navigation (React Navigation)
- [ ] Connect to existing Next.js backend API

## Phase 2.2: Voice Pipeline on Mobile
- [ ] Implement voice recording (react-native-audio-recorder-player)
- [ ] Connect to backend transcribe/chat/synthesize APIs
- [ ] Audio playback for TTS responses
- [ ] Handle app lifecycle (background/foreground audio)
- [ ] Push-to-talk button UI

## Phase 2.3: Agent Tools — Phone Integrations
Each tool is a function the LLM can call via function calling:

### Clock & Time
- [ ] `get_current_time()` — returns device local time
- [ ] `set_alarm(hour, minute, label?)` — Android AlarmManager intent
- [ ] `set_timer(duration_seconds, label?)` — Timer intent
- [ ] Native module for alarm/timer intents

### Weather
- [ ] `get_weather(city?)` — OpenWeatherMap API integration
- [ ] Use device GPS location as default
- [ ] Request location permission
- [ ] Display weather info in response

### Music
- [ ] `play_music(query?, artist?, genre?)` — send intent to music app
- [ ] `pause_music()` — Android MediaSession API (controls active playback)
- [ ] `next_track()` / `previous_track()` — MediaSession API
- [ ] Android Intent to launch music apps + MediaSession native module for playback control
- [ ] Handle "play" without specific query (resume playback via MediaSession)

### Register Tools with LLM
- [ ] Update `/api/chat` to include all tool definitions
- [ ] Implement tool execution router in mobile app
- [ ] Tool results flow back into conversation

## Phase 2.4: Permissions
- [ ] Microphone permission (required)
- [ ] Location permission (for weather)
- [ ] Notification permission (for alarms/timers)
- [ ] Permission request flow with explanations in Georgian
- [ ] Graceful degradation when permissions denied

## Phase 2.5: Basic Mobile UI
- [ ] Home screen with voice assistant
- [ ] Settings screen (select music app, language, voice)
- [ ] Permission management screen
- [ ] Basic Android notification for active listening

---

# STEP 3: Polish Mobile UI/UX & Production
**Goal**: Production-ready app with authentication, payments, and polished design.

## Phase 3.1: Design System
- [ ] Color palette and typography (Georgian font support: BPG fonts)
- [ ] Icon set
- [ ] Component library (buttons, cards, modals, inputs)
- [ ] Animations: button press, voice wave, transitions
- [ ] Dark mode support
- [ ] Onboarding screens

## Phase 3.2: Authentication
- [ ] Firebase Auth setup
- [ ] Phone number login (common in Georgia)
- [ ] Email/password as alternative
- [ ] User profile screen
- [ ] Conversation history per user

## Phase 3.3: Payment System
- [ ] Define subscription tiers (Free / Premium)
- [ ] Free tier: limited daily interactions
- [ ] Premium: unlimited + priority speed
- [ ] RevenueCat integration for in-app subscriptions
- [ ] Usage tracking and limits

## Phase 3.4: iOS Support
- [ ] iOS build configuration
- [ ] iOS-specific native modules (music, alarms)
- [ ] iOS permission flows
- [ ] App Store preparation

## Phase 3.5: Final Polish
- [ ] Error handling everywhere
- [ ] Offline state handling
- [ ] Loading skeletons
- [ ] Haptic feedback
- [ ] App icon and splash screen
- [ ] Performance profiling and optimization
- [ ] Analytics integration
- [ ] Crash reporting (Sentry)

---

# File Structure

```
voice-ai/
├── PLAN.md                          # This file
├── spike/                           # Pipeline validation
│   ├── test-pipeline.ts
│   ├── package.json
│   └── samples/                     # Test audio files
│
├── web/                             # Step 1: Next.js web app
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── .env.local                   # OPENAI_API_KEY
│   ├── public/
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx             # Main voice UI
│       │   ├── globals.css
│       │   └── api/
│       │       ├── transcribe/
│       │       │   └── route.ts     # Whisper STT
│       │       ├── chat/
│       │       │   └── route.ts     # LLM + function calling
│       │       └── synthesize/
│       │           └── route.ts     # TTS
│       ├── components/
│       │   ├── VoiceButton.tsx
│       │   ├── WaveformVisualizer.tsx
│       │   └── ConversationLog.tsx
│       ├── hooks/
│       │   ├── useVoiceRecorder.ts
│       │   └── useVoicePipeline.ts
│       ├── lib/
│       │   ├── openai.ts           # OpenAI client
│       │   ├── prompts.ts          # Georgian system prompts
│       │   ├── whisper.ts          # STT service
│       │   ├── llm.ts              # LLM service
│       │   ├── tts.ts              # TTS service (swappable)
│       │   └── tools/              # Agent tool definitions
│       │       ├── index.ts
│       │       ├── time.ts
│       │       ├── weather.ts
│       │       └── music.ts
│       └── types/
│           └── index.ts
│
├── mobile/                          # Step 2-3: React Native
│   ├── package.json
│   ├── app.json
│   ├── tsconfig.json
│   ├── android/
│   ├── ios/
│   └── src/
│       ├── App.tsx
│       ├── screens/
│       │   ├── HomeScreen.tsx       # Main voice assistant
│       │   ├── SettingsScreen.tsx
│       │   └── OnboardingScreen.tsx
│       ├── components/
│       │   ├── VoiceButton.tsx
│       │   ├── WaveformVisualizer.tsx
│       │   └── ConversationBubble.tsx
│       ├── services/
│       │   ├── api.ts              # Backend communication
│       │   ├── voice/
│       │   │   ├── recorder.ts
│       │   │   └── player.ts
│       │   ├── tools/
│       │   │   ├── clock.ts        # Time, alarm, timer
│       │   │   ├── weather.ts      # OpenWeatherMap
│       │   │   └── music.ts        # Media intents
│       │   └── permissions.ts
│       ├── hooks/
│       │   └── useVoicePipeline.ts
│       ├── navigation/
│       │   └── AppNavigator.tsx
│       └── types/
│           └── index.ts
│
└── docs/                            # Documentation
    └── api-setup.md                 # API key setup guide
```

---

# APIs Required

## Step 1 (Web App)
| API | Purpose | Where to get | Cost |
|-----|---------|--------------|------|
| **OpenAI API Key** | Whisper STT, GPT-4o, TTS | https://platform.openai.com/api-keys | Pay-as-you-go (~$5-20/month dev) |

> **One key covers everything in Step 1.** Whisper, GPT-4o-mini, GPT-4o, and TTS are all under the same OpenAI account.

## Step 2 (Mobile — additional)
| API | Purpose | Where to get | Cost |
|-----|---------|--------------|------|
| **OpenWeatherMap API Key** | Weather data | https://openweathermap.org/api | Free tier (1000 calls/day) |

## Step 3 (Production — additional)
| API | Purpose | Where to get | Cost |
|-----|---------|--------------|------|
| Firebase project | Auth, user data | https://console.firebase.google.com | Free tier |
| RevenueCat / Stripe | Payments | https://www.revenuecat.com | % of revenue |
| Sentry DSN | Crash reporting | https://sentry.io | Free tier |

## Optional / Backup
| API | Purpose | When needed |
|-----|---------|-------------|
| **Google Cloud STT** | Georgian speech-to-text (ka-GE) — confirmed working | Alternative to Whisper; same API key works for STT |
| ~~Google Cloud TTS~~ | ~~Georgian text-to-speech~~ | **Not viable — no ka-GE voices** (confirmed 2026-04-17) |
| **ElevenLabs** | Multilingual TTS that handles Georgian | If Camb.ai quality is insufficient |
| **LOVO AI API Key** | Backup TTS | Last resort |
| Spotify Web API | Richer music control | Step 2, if basic intents aren't enough |

## Deployment Note (Step 2)
The Next.js backend runs on localhost during Step 1 (web dev). When the React Native app needs to call it in Step 2, the backend must be deployed somewhere reachable. Options:
- **Vercel** (free tier) — easiest for Next.js
- **Simple VPS** — more control
- **ngrok** — temporary, for early mobile testing only

This doesn't need solving now but should be addressed at the start of Step 2.
