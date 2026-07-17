import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { OrbState } from '@/components/AIAssistantOrb';
import { colors, fonts, radius, spacing } from '@/theme';

// ── Tiny animated indicators ─────────────────────────────────────────────

/** Pulsing red recording dot (listening). */
function RecDot() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.45,
    transform: [{ scale: 0.85 + pulse.value * 0.3 }],
  }));
  return <Animated.View style={[styles.recDot, style]} />;
}

/** One bouncing dot of the thinking indicator. */
function ThinkDot({ delay }: { delay: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 200 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(v);
  }, [v, delay]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + v.value * 0.65,
    transform: [{ translateY: -v.value * 3.5 }],
  }));
  return <Animated.View style={[styles.thinkDot, style]} />;
}

function ThinkingDots() {
  return (
    <View style={styles.dotsRow}>
      <ThinkDot delay={0} />
      <ThinkDot delay={140} />
      <ThinkDot delay={280} />
    </View>
  );
}

/** One bar of the mini equalizer (speaking). */
function EqBar({ delay, duration }: { delay: number; duration: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(v);
  }, [v, delay, duration]);

  const style = useAnimatedStyle(() => ({
    height: 5 + v.value * 9,
  }));
  return <Animated.View style={[styles.eqBar, style]} />;
}

function EqBars() {
  return (
    <View style={styles.barsRow}>
      <EqBar delay={0} duration={340} />
      <EqBar delay={90} duration={260} />
      <EqBar delay={180} duration={420} />
    </View>
  );
}

// ── Status chip ──────────────────────────────────────────────────────────

type Props = {
  state: OrbState;
  transcript: string;
};

/**
 * Single status element under the orb. Fixed-height container so state
 * changes never shift the layout; the chip itself crossfades per state.
 */
export function OrbStatus({ state, transcript }: Props) {
  // Idle keeps the empty slot so state changes never shift the layout.
  if (state === 'idle') {
    return <View style={styles.slot} />;
  }

  let indicator: React.ReactNode;
  let label: string;
  let sub: string | null = null;

  if (state === 'listening') {
    indicator = <RecDot />;
    label = transcript || 'ვუსმენ…';
  } else if (state === 'thinking') {
    indicator = <ThinkingDots />;
    label = 'ვფიქრობ…';
  } else {
    indicator = <EqBars />;
    label = 'ვლაპარაკობ…';
    sub = 'შემეხე შესაწყვეტად';
  }

  return (
    <View style={styles.slot}>
      <Animated.View
        key={state}
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(150)}
        style={[styles.chip, state === 'listening' && styles.chipListening]}
      >
        {indicator}
        <Text
          style={[styles.label, state === 'listening' && styles.labelLive]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </Animated.View>
      {sub ? (
        <Animated.Text
          entering={FadeIn.delay(350).duration(300)}
          style={styles.sub}
        >
          {sub}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '94%',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  chipListening: {
    borderColor: colors.strokeBrandSoft,
    backgroundColor: 'rgba(255,77,139,0.07)',
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: 'center',
    flexShrink: 1,
  },
  labelLive: {
    color: colors.text,
  },
  sub: {
    marginTop: spacing.xs,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.outline,
  },

  recDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 14,
  },
  thinkDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.secondarySoft,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 16,
  },
  eqBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});
