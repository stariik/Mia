import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

// Thin JS wrapper over the native Android "Hey Mia" wake-word module
// (WakeWordModule.kt). Everything no-ops gracefully when the native module
// isn't present (iOS, or a dev build before the native code is linked), so
// callers don't need platform guards.

// 'detected' → foreground orb turn (handled by HomeScreen useWakeTrigger).
// 'turn'     → background/screen-off turn (handled by index.js → runWakeSession).
// 'level'    → mic level (0..1) during a native turn capture (drives the orb).
// 'turnAudio'→ final captured turn audio (base64 PCM16; null = user said nothing).
export type WakeEvent =
  | { type: 'detected' | 'turn' | 'error' | 'started' | 'stopped'; message?: string }
  | { type: 'level'; level: number }
  | { type: 'turnAudio'; audioBase64: string | null; sampleRate: number };

type WakeNative = {
  configure(modelAsset: string | null, threshold: number): Promise<void>;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  pause(): void;
  resume(): void;
  heartbeat(): void;
  startTurnCapture(): void;
  stopTurnCapture(): void;
  isEnabled(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  getInitialWakeTrigger(): Promise<boolean>;
};

const Native =
  Platform.OS === 'android'
    ? ((NativeModules.WakeWordModule as WakeNative | undefined) ?? null)
    : null;

// Must match WakeWordService.EVENT_NAME.
const WAKE_EVENT = 'WakeWordEvent';

// The custom openWakeWord model in android/app/src/main/assets/. If it were
// ever missing, the service falls back to its bundled pretrained model.
// Must match WakeWordService.MIA_MODEL_ASSET.
const MIA_MODEL_ASSET = 'mia.onnx';

// openWakeWord detection threshold (score in [0,1]); higher = fewer false
// triggers but more misses. Must match WakeWordService.DEFAULT_THRESHOLD.
const DEFAULT_THRESHOLD = 0.5;

export const wakeWord = {
  /** True when the native module is linked (Android only, for now). */
  available: Native != null,

  /** Persist engine config (wake model + detection threshold). No key needed. */
  async configure(threshold = DEFAULT_THRESHOLD): Promise<void> {
    if (!Native) return;
    await Native.configure(MIA_MODEL_ASSET, threshold);
  },

  /** Enable + start always-on listening. Resolves false if unavailable. */
  async start(): Promise<boolean> {
    if (!Native) return false;
    return Native.start();
  },

  /** Disable + tear down the listener. */
  async stop(): Promise<boolean> {
    if (!Native) return false;
    return Native.stop();
  },

  /** Release the mic for a foreground recording turn. Fire-and-forget. */
  pauseDetection(): void {
    Native?.pause();
  },

  /** Re-acquire the mic after a turn (no-op if the user disabled it). */
  resumeDetection(): void {
    Native?.resume();
  },

  /**
   * Keep a long background turn alive: refreshes the native turn wake-lock and
   * pushes the re-arm watchdog out. A continuous conversation can outlive the
   * native 60s safety timers, which would otherwise yank the mic back to wake
   * detection mid-session — call this each turn of the loop. Fire-and-forget.
   */
  heartbeat(): void {
    Native?.heartbeat();
  },

  /**
   * Record the user's turn on the shared mic (native RECORD mode). Drives the
   * orb via `level` events and resolves the turn via a `turnAudio` event — see
   * runWakeSession. Fire-and-forget; the app-closed capture path.
   */
  startTurnCapture(): void {
    Native?.startTurnCapture();
  },

  /** Stop an in-progress turn capture early (e.g. orb tapped). */
  stopTurnCapture(): void {
    Native?.stopTurnCapture();
  },

  async isEnabled(): Promise<boolean> {
    if (!Native) return false;
    return Native.isEnabled();
  },

  async isRunning(): Promise<boolean> {
    if (!Native) return false;
    return Native.isRunning();
  },

  /**
   * Whether the app was cold-launched by a wake detection. Read once on mount;
   * reading clears the flag natively.
   */
  async consumeInitialWakeTrigger(): Promise<boolean> {
    if (!Native) return false;
    return Native.getInitialWakeTrigger();
  },

  /** Subscribe to wake events. Returns an unsubscribe fn. */
  subscribe(handler: (e: WakeEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener(WAKE_EVENT, handler);
    return () => sub.remove();
  },
};
