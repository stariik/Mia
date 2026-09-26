import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import { authHeaders } from '@/api/client';
import { env } from '@/config/env';

import { buildOrbHtml } from './orbHtml';

// Thin JS wrapper over the native Android OrbOverlayModule — the floating "Hey
// Mia" orb shown during a screen-on, app-not-foreground turn. No-ops gracefully
// when the native module is absent (iOS, or before the native code is linked).
//
// The orb is the SAME WebGL HTML the in-app orb uses; we hand the built HTML to
// native, which hosts it in an overlay WebView and drives it with the identical
// JS API (setOrbState / setHover / playTTSAudio).

type OrbOverlayNative = {
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  show(html: string): Promise<boolean>;
  hide(): void;
  setState(name: string): void;
  setLevel(level: number): void;
  playTts(base64: string, mime: string): Promise<boolean>;
  speakTtsStream(
    id: string,
    text: string,
    token: string,
    url: string,
  ): Promise<boolean>;
  stopTts(): void;
};

const Native =
  Platform.OS === 'android'
    ? ((NativeModules.OrbOverlayModule as OrbOverlayNative | undefined) ?? null)
    : null;

// Must match OrbOverlayModule.EVENT_NAME.
const ORB_EVENT = 'OrbOverlayEvent';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type OrbOverlayEvent = { type: 'tap' };

let shown = false;
let nextStreamId = 0;

/** Raw JWT for the WebView's own fetch — it can't reuse RN's headers. Same
 *  extraction orbAudio.ts does for the in-app orb. */
function bearer(): string | null {
  const h = authHeaders() as Record<string, string>;
  const v = h.Authorization;
  return v ? v.replace(/^Bearer\s+/i, '') : null;
}

export const orbOverlay = {
  /** True when the native overlay module is linked (Android only, for now). */
  available: Native != null,

  /** Has the user granted "display over other apps"? */
  async hasPermission(): Promise<boolean> {
    if (!Native) return false;
    return Native.hasPermission();
  },

  /**
   * Ensure overlay permission. If missing, opens the system grant screen and
   * resolves false (the user must grant it there). Call from the foreground.
   */
  async ensurePermission(): Promise<boolean> {
    if (!Native) return false;
    if (await Native.hasPermission()) return true;
    return Native.requestPermission();
  },

  /**
   * Show the floating orb. Resolves false (and stays hidden) when overlay
   * permission is missing or the screen is off/locked — the caller then plays
   * the turn voice-only.
   */
  async show(): Promise<boolean> {
    if (!Native) return false;
    // Match the in-app orb exactly: hoverIntensity 2 (the AIAssistantOrb default
    // — the screen-off orb used buildOrbHtml's 0.2, which is why it barely
    // reacted to voice). edgeFade trims the square's transparent residual so it
    // floats cleanly over other apps.
    const ok = await Native.show(
      buildOrbHtml({
        backgroundColor: '#000000',
        hoverIntensity: 2,
        edgeFade: true,
        floatIn: true,
      }),
    );
    shown = ok;
    return ok;
  },

  /** Subscribe to overlay UI events (currently just `tap`). Returns unsubscribe. */
  subscribe(handler: (e: OrbOverlayEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener(ORB_EVENT, handler);
    return () => sub.remove();
  },

  hide(): void {
    shown = false;
    Native?.hide();
  },

  setState(name: OrbState): void {
    if (shown) Native?.setState(name);
  },

  /** Live mic level (0..1) — drives the listening "core glow". */
  setLevel(level: number): void {
    if (shown) Native?.setLevel(level);
  },

  /** Play a TTS clip through the overlay orb (it visualizes the waveform).
   *  Resolves when playback ends. No-op (resolves) if the orb isn't shown. */
  async playTts(base64: string, mime: string): Promise<void> {
    if (!Native || !shown) return;
    await Native.playTts(base64, mime);
  },

  /** True when streamed playback is possible — needs the orb up and a token. */
  canStream(): boolean {
    return Native != null && shown && bearer() != null;
  },

  /**
   * Stream one sentence through the overlay orb: its WebView fetches the audio
   * and plays it via MediaSource as it arrives, so sound starts on the first
   * bytes rather than after the whole MP3 downloads and crosses the bridge.
   *
   * Resolves when THIS sentence has finished playing; rejects if the stream
   * genuinely failed (a deliberate stop resolves, so callers can safely treat a
   * rejection as "fall back to the file path"). Call it as soon as the sentence
   * is known — the WebView overlaps the fetches and serializes playback itself.
   */
  async speakStream(text: string): Promise<void> {
    const token = bearer();
    if (!Native || !shown || !token) {
      throw new Error('orb overlay or token unavailable');
    }
    await Native.speakTtsStream(
      `o${nextStreamId++}`,
      text,
      token,
      `${env.apiBaseUrl}/api/synthesize-elevenlabs`,
    );
  },

  stopTts(): void {
    Native?.stopTts();
  },

  get isShown(): boolean {
    return shown;
  },
};
