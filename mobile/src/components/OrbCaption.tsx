import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { HIT, colors, duration, spacing, typography } from '@/theme';

// One quiet line under the orb saying what Mia is doing — the orb already
// shows it; this is for reading it and for screen readers. While the streaming
// recognizer listens it adds the minute budget and two text controls.

export type CaptionModel = {
  text: string | null;
  /** Pink mark before the text: the mic is open. */
  live?: boolean;
  /** Streaming STT controls. */
  seconds?: number;
  onFinish?: () => void;
  onKeepListening?: () => void;
  keepingOn?: boolean;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function OrbCaption({ model }: { model: CaptionModel }) {
  const reduceMotion = useReducedMotion();
  const fade = reduceMotion ? undefined : FadeIn.duration(duration.base);
  const out = reduceMotion ? undefined : FadeOut.duration(duration.fast);

  return (
    <View style={styles.slot} accessibilityLiveRegion="polite">
      {model.text ? (
        <Animated.View key={model.text} entering={fade} exiting={out} style={styles.line}>
          {model.live ? <View style={styles.mark} /> : null}
          <Text style={styles.text} numberOfLines={1}>
            {model.text}
          </Text>
          {model.seconds !== undefined ? (
            <Text style={styles.count}>{fmt(model.seconds)} / 1:00</Text>
          ) : null}
        </Animated.View>
      ) : null}
      {model.onFinish ? (
        <Animated.View entering={fade} exiting={out} style={styles.controls}>
          <Pressable
            onPress={model.onFinish}
            accessibilityRole="button"
            style={({ pressed }) => [styles.control, pressed && styles.pressed]}
          >
            <Text style={styles.controlText}>დასრულება</Text>
          </Pressable>
          <Pressable
            onPress={model.onKeepListening}
            disabled={model.keepingOn}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!model.keepingOn }}
            style={({ pressed }) => [styles.control, pressed && styles.pressed]}
          >
            <Text style={[styles.controlText, model.keepingOn && styles.controlOn]}>
              {model.keepingOn ? 'ვაგრძელებ მოსმენას' : 'განაგრძე მოსმენა'}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 24,
  },
  mark: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  text: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  count: {
    ...typography.caption,
    ...typography.numeric,
    color: colors.textFaint,
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  control: {
    minHeight: HIT,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  controlText: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.text,
  },
  controlOn: { color: colors.textFaint },
});
