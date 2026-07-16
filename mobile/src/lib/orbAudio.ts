// Singleton bridge between the React Native voice pipeline and the orb's
// WebView. Two playback paths live here:
//
//  - speak(text)  — preferred. The WebView fetches the audio itself and plays
//    it through MediaSource as it arrives, so sound starts on the first byte
//    (~1.4s) instead of after the complete file (~2.7s). RN can't do this: its
//    fetch has no ReadableStream.
//  - play(base64) — fallback for when MediaSource isn't available. RN
//    synthesizes to a file and ships it over the bridge.
//
// Both drive the orb's visualization from a real AnalyserNode inside the
// WebView, so the orb's motion reflects the actual waveform.

import type { WebView } from 'react-native-webview';

import { env } from '@/config/env';
import { authHeaders } from '@/api/client';

type Pending = {
  resolve: () => void;
  reject: (err: Error) => void;
  onStart?: () => void;
};

let pending: Pending | null = null;
let webRef: WebView | null = null;

// Streaming turns are settled by id: several sentences are in flight at once
// (fetches overlap, playback is serialized inside the WebView), so a bare
// "tts-ended" isn't enough to know which one finished.
const streamPending = new Map<string, Pending>();
let nextId = 0;

function inject(js: string) {
  webRef?.injectJavaScript(js + '; true;');
}

function bearer(): string | null {
  const h = authHeaders() as Record<string, string>;
  const v = h.Authorization;
  return v ? v.replace(/^Bearer\s+/i, '') : null;
}

function settleAllStreams(err?: Error) {
  for (const p of streamPending.values()) {
    if (err) p.reject(err);
    else p.resolve();
  }
  streamPending.clear();
}

export const orbAudio = {
  registerWebView(w: WebView | null) {
    webRef = w;
  },

  /** True when streaming is even possible — needs a WebView and a token. */
  canStream(): boolean {
    return !!webRef && !!bearer();
  },

  /**
   * Enqueue one sentence for streamed playback. Returns when THIS sentence has
   * finished playing. Call it as soon as the sentence is known: the WebView
   * starts fetching immediately and plays queued items in order, which is what
   * keeps synthesis of later sentences overlapping playback of earlier ones.
   */
  speak(text: string, onStart?: () => void): Promise<void> {
    const token = bearer();
    if (!webRef || !token) {
      return Promise.reject(new Error('orb webview or token unavailable'));
    }
    const id = `s${nextId++}`;
    return new Promise<void>((resolve, reject) => {
      streamPending.set(id, { resolve, reject, onStart });
      const payload = JSON.stringify({
        id,
        text,
        token,
        url: `${env.apiBaseUrl}/api/synthesize-elevenlabs`,
      });
      inject(`window.speakTTSStream && window.speakTTSStream(${payload})`);
    });
  },

  /** Fallback path: play an already-synthesized clip handed over as base64. */
  play(base64: string, mime: string): Promise<void> {
    if (pending) {
      pending.reject(new Error('TTS playback interrupted by another call'));
      pending = null;
    }
    return new Promise<void>((resolve, reject) => {
      pending = { resolve, reject };
      const payload = JSON.stringify({ base64, mime });
      inject(`window.playTTSAudio && window.playTTSAudio(${payload})`);
    });
  },

  stop() {
    inject('window.stopTTSAudio && window.stopTTSAudio()');
    if (pending) {
      pending.resolve();
      pending = null;
    }
    // stopTTSAudio drops the WebView's queue without reporting each item, so
    // resolve them here or every in-flight sentence would hang forever.
    settleAllStreams();
  },

  // Called from the orb component's onMessage handler.
  onEvent(kind: 'tts-started' | 'tts-ended' | 'tts-error', payload?: unknown) {
    const id =
      payload && typeof payload === 'object' && 'id' in payload
        ? String((payload as { id: unknown }).id)
        : null;

    if (id) {
      const p = streamPending.get(id);
      if (!p) return;
      if (kind === 'tts-started') {
        p.onStart?.();
        return; // still playing — don't settle
      }
      streamPending.delete(id);
      if (kind === 'tts-ended') p.resolve();
      else {
        const e =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'TTS stream failed';
        p.reject(new Error(e));
      }
      return;
    }

    // No id → the base64 fallback path, which reports its own start directly.
    if (kind === 'tts-started') return;
    if (!pending) return;
    const p = pending;
    pending = null;
    if (kind === 'tts-ended') p.resolve();
    else p.reject(new Error(typeof payload === 'string' ? payload : 'TTS playback failed'));
  },
};
