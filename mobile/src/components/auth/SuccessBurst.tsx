import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  Easing,
  FadeInDown,
  interpolate,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { brandGradient, colors, fonts, spacing, typography } from '@/theme';

// Success moment: a gradient medallion springs in, the check mark draws
// itself, and a ring of confetti dots bursts outward.

const AnimatedPath = Reanimated.createAnimatedComponent(Path);
const CHECK_LEN = 34;
const SIZE = 92;
const PARTICLES = 12;

function Particle({ index, t }: { index: number; t: SharedValue<number> }) {
  const angle = (index / PARTICLES) * Math.PI * 2;
  const dist = 64 + (index % 3) * 12;
  const color = brandGradient[index % 3];
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 1], [0, 1, 0]),
    transform: [
      { translateX: Math.cos(angle) * dist * t.value },
      { translateY: Math.sin(angle) * dist * t.value },
      { scale: interpolate(t.value, [0, 0.3, 1], [0.4, 1.2, 0.5]) },
    ],
  }));
  return <Reanimated.View style={[styles.particle, { backgroundColor: color }, style]} />;
}

export function SuccessBurst({ title, subtitle }: { title: string; subtitle: string }) {
  const pop = useSharedValue(0);
  const draw = useSharedValue(0);
  const burst = useSharedValue(0);

  useEffect(() => {
    pop.value = withSpring(1, { damping: 11, stiffness: 180 });
    draw.value = withDelay(180, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    burst.value = withDelay(260, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
  }, [pop, draw, burst]);

  const medalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    opacity: interpolate(pop.value, [0, 0.4], [0, 1], 'clamp'),
  }));
  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LEN * (1 - draw.value),
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.stage}>
        {Array.from({ length: PARTICLES }, (_, i) => (
          <Particle key={i} index={i} t={burst} />
        ))}
        <Reanimated.View style={[styles.medal, medalStyle]}>
          <LinearGradient
            colors={[...brandGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Svg width={46} height={46} viewBox="0 0 24 24" fill="none">
            <AnimatedPath
              d="m5.5 12.5 4.2 4.2 8.8-9.2"
              stroke="#fff"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={CHECK_LEN}
              animatedProps={checkProps}
            />
          </Svg>
        </Reanimated.View>
      </View>
      <Reanimated.Text entering={FadeInDown.delay(260).springify().damping(16)} style={styles.title}>
        {title}
      </Reanimated.Text>
      <Reanimated.View entering={FadeInDown.delay(380).springify().damping(16)}>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  stage: {
    width: SIZE * 2,
    height: SIZE + spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medal: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  particle: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  title: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
