import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, fonts, spacing } from '@/theme';

// Four-segment strength meter that fills with a spring as the password grows,
// tinted from red → amber → green.

const LEVELS = [
  { label: 'ძალიან მოკლე', color: colors.outline },
  { label: 'სუსტი', color: colors.danger },
  { label: 'საშუალო', color: colors.warning },
  { label: 'კარგი', color: '#a8e28a' },
  { label: 'ძლიერი', color: colors.success },
];

export function scorePassword(pw: string): number {
  if (pw.length < 6) return 0;
  let s = 1;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  else if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s += 0.5;
  return Math.min(4, Math.floor(s));
}

function Segment({ index, fill, color }: { index: number; fill: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(fill.value, [index, index + 1], [0, 1], 'clamp') }],
  }));
  return (
    <View style={styles.track}>
      <Reanimated.View style={[styles.fill, { backgroundColor: color }, style]} />
    </View>
  );
}

export function PasswordStrength({ password }: { password: string }) {
  const score = scorePassword(password);
  const fill = useSharedValue(0);
  const level = LEVELS[score];

  useEffect(() => {
    // A short password still shows a sliver of progress so typing feels alive.
    const target = score === 0 ? Math.min(password.length / 6, 0.9) : score;
    fill.value = withSpring(target, { damping: 16, stiffness: 160 });
  }, [score, password.length, fill]);

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {[0, 1, 2, 3].map((i) => (
          <Segment key={i} index={i} fill={fill} color={score === 0 ? colors.danger : level.color} />
        ))}
      </View>
      <Text style={[styles.label, { color: password ? level.color : colors.outline }]}>
        {password ? level.label : 'პაროლის სიძლიერე'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  track: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fill: {
    flex: 1,
    borderRadius: 3,
    transformOrigin: 'left center',
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    minWidth: 92,
    textAlign: 'right',
  },
});
