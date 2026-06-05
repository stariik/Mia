// Singleton bridge between the React Native voice pipeline and the orb's
// WebView. The WebView plays TTS audio via HTML5 Audio + Web Audio API and
// drives its own visualization from a real AnalyserNode — so the pipeline
// just hands a base64-encoded audio blob over and awaits the "tts-ended"
// event posted back from the WebView.

import type { WebView } from 'react-native-webview';

type Pending = {
  resolve: () => void;
  reject: (err: Error) => void;
};

let pending: Pending | null = null;
let webRef: WebView | null = null;

function inject(js: string) {
  webRef?.injectJavaScript(js + '; true;');
}

export const orbAudio = {
  registerWebView(w: WebView | null) {
    webRef = w;
  },

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
  },

  // Called from the orb component's onMessage handler.
  onEvent(kind: 'tts-ended' | 'tts-error', payload?: unknown) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (kind === 'tts-ended') p.resolve();
    else p.reject(new Error(typeof payload === 'string' ? payload : 'TTS playback failed'));
  },
};
