# Mia — Georgian Voice Assistant

**Mia** (მია) is a voice assistant that speaks Georgian — a language most mainstream assistants don't support. Talk to it naturally in Georgian and it answers back with a natural voice: set alarms and timers, check the weather, play music, translate conversations in real time, or just chat.

Android app built with React Native, backed by a Next.js API server. Live at [miavoice.online](https://miavoice.online).

## Screenshots

<!-- Drop your images into docs/screenshots/ and they'll appear here -->

| Home | Translator | Alarms |
|:---:|:---:|:---:|
| ![Home](docs/screenshots/home.png) | ![Translator](docs/screenshots/translator.png) | ![Alarms](docs/screenshots/alarms.png) |

## What it can do

- 🎙️ **Voice conversations in Georgian** — tap the orb (or say **"Hey Mia"**, even with the app closed) and speak naturally
- ⏰ **Alarms & timers** — set and cancel by voice; delivered as real Android alarms that ring even in the background
- 🌤️ **Weather** — location-aware forecasts, spoken back in Georgian
- 🎵 **Music** — play music by voice command
- 🌍 **Interpreter mode** — live two-way translation between Georgian and Russian/English: each side speaks their language, Mia voices the other
- 🧮 **Time & math** — current time, date, and calculations
- 📜 **Conversation history** — past conversations persist on-device

## How it works

```
  ┌─────────────────────────┐         ┌──────────────────────────────┐
  │   Android app (mobile/) │         │   API server (web/)          │
  │   React Native 0.85     │  HTTPS  │   Next.js 16                 │
  │                         │ ──────► │                              │
  │  wake word · mic capture│         │  STT: Google Chirp 2         │
  │  orb UI · playback      │ ◄────── │  LLM: OpenAI (tool calling)  │
  │  alarms/timers (notifee)│   SSE   │  TTS: ElevenLabs eleven_v3   │
  └─────────────────────────┘         └──────────────────────────────┘
```

A voice turn: the app records audio → the server transcribes it (Google Speech-to-Text **Chirp 2**, one of the few STT models with solid Georgian support) → an OpenAI model decides what to do, calling tools (weather, alarms, music, …) when needed → the reply is synthesized with **ElevenLabs eleven_v3** (Google TTS has no Georgian voices) and streamed back for playback.

Wake word detection ("Hey Mia") runs fully on-device via [openWakeWord](https://github.com/dscripka/openWakeWord) ONNX models — no cloud, no API key, works with the app closed.

## Repo layout

```
voice-ai/
├── web/       Next.js app — API routes (chat, STT, TTS, translate, auth),
│              tool handlers, privacy & account pages
├── mobile/    React Native Android app — screens, orb UI, wake word,
│              native audio capture, alarm/timer scheduling
├── DEPLOY.md  Backend deployment runbook (Docker + Caddy on a VPS)
└── audit/     Pre-launch audit notes
```

## Running locally

### Backend (`web/`)

Requires Node 22+, an OpenAI API key, an ElevenLabs API key, and a Google Cloud service account with Speech-to-Text enabled.

```bash
cd web
npm install
cp .env.example .env   # fill in keys
npm run dev:all        # Next.js on :3002 + WebSocket server
```

### Android app (`mobile/`)

Requires the React Native Android toolchain (JDK 17, Android SDK) and a device or emulator.

```bash
cd mobile
npm install
npm run tunnels        # adb reverse so the device reaches your local backend
npm run android
```

`mobile/src/config/env.ts` switches between the local backend and production.

## Tech stack

| | |
|---|---|
| **Mobile** | React Native 0.85 (bare), TypeScript, Zustand, Reanimated, Notifee, react-native-svg |
| **Backend** | Next.js 16, TypeScript, Tailwind CSS 4, WebSocket (ws) |
| **Speech-to-text** | Google Cloud Speech (Chirp 2) |
| **Text-to-speech** | ElevenLabs eleven_v3 |
| **LLM** | OpenAI with function calling |
| **Wake word** | openWakeWord (ONNX, on-device) |
| **Infra** | Docker + Caddy on Hetzner, Sentry crash reporting |

## Status

Android-first, preparing for Play Store launch. iOS is planned after (without the wake word — iOS doesn't allow background mic access for third-party apps).
