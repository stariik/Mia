import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { SharedValue } from 'react-native-reanimated';

import { buildOrbHtml } from '@/lib/orbHtml';
import { orbAudio } from '@/lib/orbAudio';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface AIAssistantOrbProps {
  state: OrbState;
  /**
   * Audio amplitude in 0..1.
   *
   * - `number` — fine for static or low-frequency updates.
   * - `SharedValue<number>` — recommended for live mic input. Read at 20 Hz
   *   from the JS thread and pushed into the WebGL shader's `hover` uniform.
   */
  audioLevel?: number | SharedValue<number>;
  size?: number;
  hue?: number;
  hoverIntensity?: number;
  forceHoverState?: boolean;
  backgroundColor?: string;
}

const PUSH_INTERVAL_MS = 50;

const isSharedNumber = (v: unknown): v is SharedValue<number> =>
  v != null && typeof v === 'object' && 'value' in (v as Record<string, unknown>);

export function AIAssistantOrb({
  state,
  audioLevel,
  size = 240,
  hue = 0,
  hoverIntensity = 2,
  forceHoverState = false,
  backgroundColor = '#000000',
}: AIAssistantOrbProps) {
  const webRef = useRef<WebView>(null);
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  const html = useMemo(
    () =>
      buildOrbHtml({
        hue,
        hoverIntensity,
        rotateOnHover: true,
        forceHoverState,
        backgroundColor,
      }),
    [hue, hoverIntensity, forceHoverState, backgroundColor],
  );

  useEffect(() => {
    let lastSent = -1;

    const id = setInterval(() => {
      let amp = 0;
      const s = stateRef.current;

      if (s === 'listening') {
        if (typeof audioLevel === 'number') amp = audioLevel;
        else if (isSharedNumber(audioLevel)) amp = audioLevel.value;
      }
      // While speaking, the WebView's own AnalyserNode drives targetHover
      // directly from the playing audio — RN must not push competing values.

      if (amp < 0) amp = 0;
      else if (amp > 1) amp = 1;

      if (Math.abs(amp - lastSent) < 0.005) return;
      lastSent = amp;

      const js = `window.setHover && window.setHover(${amp.toFixed(3)}); true;`;
      webRef.current?.injectJavaScript(js);
    }, PUSH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [audioLevel]);

  return (
    <View
      pointerEvents="none"
      style={{
        width: size,
        height: size,
        backgroundColor: 'transparent',
        overflow: 'hidden',
      }}
    >
      <WebView
        ref={(w) => {
          webRef.current = w;
          orbAudio.registerWebView(w);
        }}
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
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
            if (msg.kind === 'error') console.warn('[Orb]', msg.payload);
            else if (msg.kind === 'ready') console.log('[Orb] ready', msg.payload);
            else if (msg.kind === 'tts-ended') orbAudio.onEvent('tts-ended');
            else if (msg.kind === 'tts-error') {
              console.warn('[Orb] tts-error', msg.payload);
              orbAudio.onEvent('tts-error', msg.payload);
            }
          } catch {
            console.log('[Orb]', e.nativeEvent.data);
          }
        }}
        onError={(e) => console.warn('[Orb] webview error', e.nativeEvent)}
        onHttpError={(e) =>
          console.warn('[Orb] http error', e.nativeEvent.statusCode, e.nativeEvent.url)
        }
      />
    </View>
  );
}
