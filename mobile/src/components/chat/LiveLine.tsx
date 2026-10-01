import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, spacing, typography } from '@/theme';

/** Words being spoken right now: the user's transcript as it forms, with a
 *  slow-breathing accent mark that says "still listening". */
export function LiveLine({
  text,
  align = 'right',
}: {
  text: string;
  align?: 'left' | 'right';
}) {
  const reduceMotion = useReducedMotion();
  const v = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    v.value = withRepeat(
      withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(v);
  }, [v, reduceMotion]);
  const dot = useAnimatedStyle(() => ({ opacity: v.value }));

  return (
    <View
      style={[styles.row, align === 'left' && styles.left]}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.text}>{text}</Text>
      <Animated.View style={[styles.mark, dot]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  left: { justifyContent: 'flex-start' },
  text: {
    ...typography.body,
    color: colors.textFaint,
    flexShrink: 1,
  },
  mark: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginBottom: 8,
  },
});
