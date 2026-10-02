import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { audioLevel } from '@/lib/audioLevel';
import { colors, duration, radius, spacing, typography } from '@/theme';

// What Mia is doing, under the orb. While she listens there are no words: a
// ribbon of gradient bars moves with your voice, and it doubles as the
// listening budget — every bar is lit when the mic opens and they dim one by
// one from the right as the minute runs out. Before the mic is open the same
// bars rest as dots with a light running through them. Other states are one
// quiet line of text. The text is always the screen-reader label.

export type CaptionModel = {
  text: string | null;
  /** Draw the voice ribbon instead of the text line. */
  wave?: 'live' | 'connecting';
  /** Share of the listening budget left, 0..1. Omitted: no budget. */
  remaining?: number;
  /** A short line under the ribbon (the translator's "speak English"). */
  hint?: string;
  /** Streaming STT controls. */
  onFinish?: () => void;
  onKeepListening?: () => void;
  keepingOn?: boolean;
};

export function OrbCaption({ model }: { model: CaptionModel }) {
  const reduceMotion = useReducedMotion();
  const fade = reduceMotion ? undefined : FadeIn.duration(duration.base);
  const out = reduceMotion ? undefined : FadeOut.duration(duration.fast);

  return (
    <View style={styles.slot} accessibilityLiveRegion="polite">
      {model.wave ? (
        // One key for every listening model, so the ribbon carries over from
        // "connecting" to "live" and grows instead of being replaced.
        <Animated.View
          key="wave"
          entering={fade}
          exiting={out}
          style={styles.waveBlock}
          accessible
          accessibilityLabel={model.text ?? undefined}
        >
          <VoiceRibbon mode={model.wave} remaining={model.remaining} />
          {model.hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {model.hint}
            </Text>
          ) : null}
        </Animated.View>
      ) : model.text ? (
        <Animated.View key={model.text} entering={fade} exiting={out} style={styles.line}>
          <Text style={styles.text} numberOfLines={1}>
            {model.text}
          </Text>
        </Animated.View>
      ) : null}
      {model.onFinish ? (
        <Animated.View entering={fade} exiting={out} style={styles.controls}>
          <Pressable
            onPress={model.onFinish}
            accessibilityRole="button"
            hitSlop={4}
            style={({ pressed }) => [styles.chip, styles.chipSend, pressed && styles.pressed]}
          >
            <Icon name="check" size={16} color={colors.primary} strokeWidth={2} />
            <Text style={styles.chipText}>დასრულება</Text>
          </Pressable>
          <Pressable
            onPress={model.onKeepListening}
            disabled={model.keepingOn}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!model.keepingOn, selected: !!model.keepingOn }}
            hitSlop={4}
            style={({ pressed }) => [
              styles.chip,
              model.keepingOn && styles.chipOn,
              pressed && styles.pressed,
            ]}
          >
            <Icon
              name="infinity"
              size={16}
              color={model.keepingOn ? colors.primary : colors.textMuted}
              strokeWidth={2}
            />
            <Text style={[styles.chipText, model.keepingOn && styles.chipTextOn]}>
              {model.keepingOn ? 'ვაგრძელებ მოსმენას' : 'განაგრძე მოსმენა'}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ── The voice ribbon ─────────────────────────────────────────────────────

const BARS = 23;
const BAR_W = 3;
const BAR_GAP = 3;
const WAVE_H = 26;
const DOT = BAR_W;

// Centre bars reach highest, so the ribbon reads as one voice, not a meter.
const ENVELOPE = Array.from({ length: BARS }, (_, i) => {
  const x = (i - (BARS - 1) / 2) / ((BARS - 1) / 2);
  return 0.32 + 0.68 * Math.exp(-x * x * 2.4);
});

// Each bar takes its own colour from the brand gradient (violet → pink at
// 55% → coral), the same stops as the wordmark and the orb.
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  return `rgb(${pa.map((v, k) => Math.round(v + (pb[k] - v) * t)).join(',')})`;
}
const BAR_COLORS = Array.from({ length: BARS }, (_, i) => {
  const t = i / (BARS - 1);
  return t < 0.55
    ? mix(colors.gradientStart, colors.gradientMid, t / 0.55)
    : mix(colors.gradientMid, colors.gradientEnd, (t - 0.55) / 0.45);
});

function VoiceRibbon({
  mode,
  remaining,
}: {
  mode: 'live' | 'connecting';
  remaining?: number;
}) {
  const still = useReducedMotion();
  const clock = useSharedValue(0);
  const level = useSharedValue(0);
  const live = useSharedValue(mode === 'live' ? 1 : 0);
  const left = useSharedValue(remaining ?? 1);

  useEffect(() => {
    live.value = still
      ? mode === 'live'
        ? 1
        : 0
      : withTiming(mode === 'live' ? 1 : 0, { duration: duration.mode, easing: Easing.out(Easing.cubic) });
  }, [mode, live, still]);

  // The budget ticks once a second; glide between ticks so the dimming is
  // continuous rather than a bar at a time.
  useEffect(() => {
    left.value = withTiming(remaining ?? 1, { duration: 1000, easing: Easing.linear });
  }, [remaining, left]);

  useFrameCallback((frame) => {
    clock.value += (frame.timeSincePreviousFrame ?? 16) / 1000;
    // audioLevel is dBFS mapped to 0..1; speech sits around 0.45–0.85.
    const target = Math.max(0, Math.min(1, (audioLevel.value - 0.25) / 0.55));
    // Quick to rise, slow to fall — syllables pop, pauses settle.
    level.value += (target - level.value) * (target > level.value ? 0.35 : 0.08);
  }, !still);

  return (
    <View style={styles.wave}>
      {ENVELOPE.map((env, i) => (
        <RibbonBar
          key={i}
          index={i}
          env={env}
          color={BAR_COLORS[i]}
          clock={clock}
          level={level}
          live={live}
          left={left}
          still={still}
        />
      ))}
    </View>
  );
}

function RibbonBar({
  index,
  env,
  color,
  clock,
  level,
  live,
  left,
  still,
}: {
  index: number;
  env: number;
  color: string;
  clock: SharedValue<number>;
  level: SharedValue<number>;
  live: SharedValue<number>;
  left: SharedValue<number>;
  still: boolean;
}) {
  const style = useAnimatedStyle(() => {
    // Budget: bars past the remaining share fade down to a faint trace.
    const lit = Math.max(0, Math.min(1, left.value * BARS - index));
    const litOpacity = 0.2 + 0.8 * lit;

    if (still) {
      return {
        height: DOT + (WAVE_H - DOT) * 0.3 * env * live.value,
        opacity: live.value > 0.5 ? litOpacity : 0.45,
      };
    }

    const t = clock.value;
    // Live: two slow ripples cross the ribbon so neighbours never move in
    // lockstep, plus a faint breath while you're silent.
    const ripple = 0.62 + 0.38 * Math.sin(t * 6.2 - index * 0.62) * Math.cos(t * 1.9 + index * 0.37);
    const breath = 0.07 * (0.5 + 0.5 * Math.sin(t * 2.2 - index * 0.5));
    const drive = Math.min(1, level.value * ripple * 1.2 + breath);
    const liveH = DOT + (WAVE_H - DOT) * env * drive;

    // Connecting: dots at rest, a soft light running left to right.
    const run = 0.5 + 0.5 * Math.sin(t * 4.2 - index * 0.42);
    const connectOpacity = 0.18 + 0.62 * run * run * run;

    const k = live.value;
    return {
      height: DOT + (liveH - DOT) * k,
      opacity: connectOpacity + (litOpacity - connectOpacity) * k,
    };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
  },
  text: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  waveBlock: {
    alignItems: 'center',
    gap: spacing.xxs,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
    height: WAVE_H,
  },
  bar: {
    width: BAR_W,
    borderRadius: BAR_W / 2,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: 36,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
  },
  chipSend: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.strokeBrand,
  },
  chipOn: {
    backgroundColor: colors.primaryGlow,
    borderColor: colors.strokeBrand,
  },
  pressed: { opacity: 0.6 },
  chipText: {
    ...typography.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  chipTextOn: { color: colors.primarySoft },
});
