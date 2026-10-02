import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { bgAlpha, colors } from '@/theme';

// The conversation's light. Three soft fields of the orb's own colours drift
// slowly behind the messages, and their balance follows what Mia is doing:
//   listening → pink rises (warm, attentive)
//   thinking  → violet gathers (cool, inward)
//   speaking  → coral and pink bloom (her voice)
//   idle      → a quiet violet glow
// Each field is a static SVG radial gradient drawn once; only transform and
// opacity animate, on the UI thread, so it costs nothing while you scroll.
// The top edge fades to the ground so the orb above meets the chat cleanly.

export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking';

type Blob = {
  key: 'violet' | 'pink' | 'coral';
  color: string;
  /** Centre as a fraction of the panel, and size as a fraction of its width. */
  x: number;
  y: number;
  size: number;
  /** Drift amplitude (px) and period (ms) — all different, so it never syncs. */
  dx: number;
  dy: number;
  period: number;
};

const BLOBS: Blob[] = [
  { key: 'violet', color: colors.gradientStart, x: 0.12, y: 0.78, size: 1.25, dx: 34, dy: 22, period: 13000 },
  { key: 'pink', color: colors.gradientMid, x: 0.92, y: 0.5, size: 1.05, dx: 28, dy: 30, period: 11000 },
  { key: 'coral', color: colors.gradientEnd, x: 0.5, y: 1.05, size: 1.1, dx: 40, dy: 16, period: 15000 },
];

// Peak opacity of each field per mood. Kept low: even where all three
// centres would stack at their peaks, muted text stays above 4.5:1 (AA).
const MIX: Record<Mood, Record<Blob['key'], number>> = {
  idle: { violet: 0.2, pink: 0.07, coral: 0.05 },
  listening: { violet: 0.1, pink: 0.22, coral: 0.08 },
  thinking: { violet: 0.28, pink: 0.08, coral: 0.04 },
  speaking: { violet: 0.1, pink: 0.16, coral: 0.18 },
};

function Field({
  blob,
  width,
  height,
  level,
  still,
}: {
  blob: Blob;
  width: number;
  height: number;
  level: SharedValue<number>;
  still: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: blob.period, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(t);
  }, [still, blob.period, t]);

  const d = width * blob.size;
  const style = useAnimatedStyle(() => ({
    opacity: level.value,
    transform: [
      { translateX: (t.value - 0.5) * 2 * blob.dx },
      { translateY: (0.5 - t.value) * 2 * blob.dy },
      { scale: 0.94 + t.value * 0.12 },
    ],
  }));

  return (
    <Animated.View
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[
        styles.field,
        {
          width: d,
          height: d,
          left: width * blob.x - d / 2,
          // Anchored to the bottom, which stays put when typing mode
          // stretches the panel upward.
          bottom: height * (1 - blob.y) - d / 2,
        },
        style,
      ]}
    >
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id={`cf-${blob.key}`}>
            <Stop offset="0" stopColor={blob.color} stopOpacity={1} />
            <Stop offset="0.45" stopColor={blob.color} stopOpacity={0.45} />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={`url(#cf-${blob.key})`} />
      </Svg>
    </Animated.View>
  );
}

export function ColourField({ mood, height }: { mood: Mood; height: number }) {
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const violet = useSharedValue(MIX[mood].violet);
  const pink = useSharedValue(MIX[mood].pink);
  const coral = useSharedValue(MIX[mood].coral);

  useEffect(() => {
    const ease = { duration: still ? 0 : 900, easing: Easing.inOut(Easing.cubic) };
    violet.value = withTiming(MIX[mood].violet, ease);
    pink.value = withTiming(MIX[mood].pink, ease);
    coral.value = withTiming(MIX[mood].coral, ease);
  }, [mood, still, violet, pink, coral]);

  const levels = { violet, pink, coral };
  if (height <= 0) return null;

  return (
    <View pointerEvents="none" style={styles.root}>
      {BLOBS.map((b) => (
        <Field
          key={b.key}
          blob={b}
          width={width}
          height={height}
          level={levels[b.key]}
          still={still}
        />
      ))}
      <LinearGradient
        colors={[colors.bgDeep, bgAlpha(0)]}
        style={styles.topFade}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  field: { position: 'absolute' },
  topFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 96,
  },
});
