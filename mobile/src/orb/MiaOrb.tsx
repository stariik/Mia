import React, {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { NavigationContext } from '@react-navigation/native';

import { dlog } from '@/lib/log';
import { orbAudio } from '@/lib/orbAudio';

import { buildOrbPage } from './buildOrbPage';
import type { OrbConfigOverrides, OrbState } from './config';
import { consumeMicOnset, takeMicFrame, type MicFrame } from './micAnalysis';

// Dev-only page tools (synthetic voice, perf reports). Required behind __DEV__
// so Metro folds it out of release bundles entirely.
const DEV_TOOLS_JS: string | null = __DEV__
  ? require('./page/devTools').ORB_DEV_TOOLS_JS
  : null;

export type OrbPerf = {
  /** Frames actually drawn per second (60 active, 30 calm). */
  fps: number;
  ms: number;
  tier: number;
  dpr: number;
  slices: number;
  /** Interior resolution scale, and both render sizes. */
  inner: number;
  px: string;
  ipx: string;
  calm: boolean;
  fallback: boolean;
};

/** Imperative handle — dev tooling only (no-ops in release pages). */
export type MiaOrbHandle = {
  /** Simulate a voice: 'mic' (user) or 'tts' (Mia); null stops. */
  simulate(channel: 'mic' | 'tts' | null, mode?: 'speech' | 'procedural', audible?: boolean): void;
  setReducedMotion(on: boolean): void;
  /** Perf reports (~1/s) from dev pages. Returns unsubscribe. */
  onPerf(cb: (p: OrbPerf) => void): () => void;
};

export type MiaOrbProps = {
  /** What Mia is doing. 'error' dims the orb gently. */
  state: OrbState;
  /** Square size in dp. */
  size?: number;
  /**
   * Mic input: a source of analyzed frames. Defaults to the app-wide mic
   * analysis (fed by the capture callbacks). Mia's own voice needs no input:
   * TTS plays through this orb's WebView (via orbAudio) and is analyzed there.
   */
  mic?: () => MicFrame;
  /** Stop rendering (audio keeps playing). Also automatic when the screen is
   *  unfocused or the app is backgrounded. */
  paused?: boolean;
  /** Per-instance overrides of ORB_CONFIG. */
  config?: OrbConfigOverrides;
  /**
   * Translator mode: 1 cross-fades the palette to ORB_CONFIG.translatorPalette
   * (over ORB_CONFIG.tintMs), 0 fades back. Nothing else about the orb
   * changes. Default 0 — the theme palette, exactly.
   */
  tint?: number;
  ref?: React.Ref<MiaOrbHandle>;
};

const MIC_PUSH_MS = 32;
const TOUCH_MOVE_MS = 33;

/**
 * Mia's voice orb — a glass marble with a living interior ("Glass & Ink").
 * Rendered by a self-contained WebGL page inside a transparent WebView; the
 * same page hosts Mia's TTS playback, so its analyser sees the real voice.
 */
export function MiaOrb({
  state,
  size = 280,
  mic = takeMicFrame,
  paused = false,
  config,
  tint = 0,
  ref,
}: MiaOrbProps) {
  const webRef = useRef<WebView | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tintRef = useRef(tint);
  tintRef.current = tint;
  const perfSubs = useRef(new Set<(p: OrbPerf) => void>());

  const configKey = config ? JSON.stringify(config) : '';
  const html = useMemo(
    () => buildOrbPage({ config, devTools: DEV_TOOLS_JS }),
    // configKey stands in for the object's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey],
  );

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  useEffect(() => {
    inject(`window.orb && orb.state(${JSON.stringify(state)})`);
  }, [state, inject]);

  useEffect(() => {
    inject(`window.orb && orb.setTint && orb.setTint(${tint})`);
  }, [tint, inject]);

  // ── Pause when nobody can see it ───────────────────────────────────────
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const active = !paused && focused && appActive;
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    inject(`window.orb && orb.setActive(${active})`);
  }, [active, inject]);

  // ── Reduced motion ─────────────────────────────────────────────────────
  const reducedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const apply = (on: boolean) => {
      reducedRef.current = on;
      inject(`window.orb && orb.setReducedMotion(${on})`);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && apply(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', apply);
    return () => {
      alive = false;
      sub.remove();
    };
  }, [inject]);

  // ── Mic bands → page, only while listening ─────────────────────────────
  useEffect(() => {
    if (state !== 'listening' || !active) return;
    let lastSeq = -1;
    const id = setInterval(() => {
      const f = mic();
      if (f.seq === lastSeq) return;
      lastSeq = f.seq;
      inject(
        `window.orb && orb.mic(${f.level.toFixed(3)},${f.low.toFixed(3)},${f.mid.toFixed(3)},${f.high.toFixed(3)},${f.onset.toFixed(3)})`,
      );
      if (f.onset > 0) consumeMicOnset();
    }, MIC_PUSH_MS);
    return () => clearInterval(id);
  }, [state, active, mic, inject]);

  // ── Touch: tilt toward the finger + a press ripple ─────────────────────
  // Raw touch events don't claim the responder, so a parent Pressable still
  // gets the tap.
  const lastMove = useRef(0);
  const sendTouch = useCallback(
    (e: GestureResponderEvent, phase: 0 | 1 | 2) => {
      const { locationX, locationY } = e.nativeEvent;
      const x = (locationX / size) * 2 - 1;
      const y = 1 - (locationY / size) * 2;
      inject(`window.orb && orb.touch(${x.toFixed(3)},${y.toFixed(3)},${phase})`);
    },
    [size, inject],
  );

  useImperativeHandle(
    ref,
    () => ({
      simulate(channel, mode = 'speech', audible = false) {
        inject(
          `window.__orbDev && __orbDev.sim(${JSON.stringify(channel)}, ${JSON.stringify(mode)}, ${audible})`,
        );
      },
      setReducedMotion(on) {
        inject(`window.orb && orb.setReducedMotion(${on || reducedRef.current})`);
      },
      onPerf(cb) {
        perfSubs.current.add(cb);
        return () => perfSubs.current.delete(cb);
      },
    }),
    [inject],
  );

  return (
    <View
      pointerEvents="box-only"
      style={[styles.box, { width: size, height: size }]}
      onTouchStart={(e) => sendTouch(e, 0)}
      onTouchMove={(e) => {
        const now = Date.now();
        if (now - lastMove.current < TOUCH_MOVE_MS) return;
        lastMove.current = now;
        sendTouch(e, 1);
      }}
      onTouchEnd={(e) => sendTouch(e, 2)}
      onTouchCancel={(e) => sendTouch(e, 2)}
    >
      <WebView
        ref={(w) => {
          webRef.current = w;
          orbAudio.registerWebView(w);
        }}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        androidLayerType="hardware"
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        pointerEvents="none"
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        cacheEnabled
        textZoom={100}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.kind === 'error') console.error('[Orb] page error', msg.payload);
            else if (msg.kind === 'ready') dlog('[Orb] ready', msg.payload);
            else if (msg.kind === 'fallback') dlog('[Orb] canvas fallback:', msg.payload);
            else if (msg.kind === 'perf') perfSubs.current.forEach((cb) => cb(msg.payload));
            else if (msg.kind === 'tts-started') orbAudio.onEvent('tts-started', msg.payload);
            else if (msg.kind === 'tts-ended') orbAudio.onEvent('tts-ended', msg.payload);
            else if (msg.kind === 'tts-error') {
              dlog('[Orb] tts-error', msg.payload);
              orbAudio.onEvent('tts-error', msg.payload);
            }
          } catch {
            dlog('[Orb]', e.nativeEvent.data);
          }
        }}
        onLoadEnd={() => {
          // Effects may have fired before the page booted; sync everything.
          inject(
            `window.orb && (orb.state(${JSON.stringify(stateRef.current)}),` +
              `orb.setActive(${activeRef.current}),` +
              `orb.setReducedMotion(${reducedRef.current}),` +
              `orb.setTint && orb.setTint(${tintRef.current}))`,
          );
        }}
        onRenderProcessGone={(e) => {
          // Android killed the WebView's renderer (memory pressure). Unwind any
          // in-flight TTS immediately so the turn doesn't hang on promises the
          // dead page can never settle.
          console.error('[Orb] render process gone', e.nativeEvent);
          orbAudio.onWebViewGone();
        }}
        onError={(e) => console.error('[Orb] webview error', e.nativeEvent)}
        onHttpError={(e) =>
          dlog('[Orb] http error', e.nativeEvent.statusCode, e.nativeEvent.url)
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
