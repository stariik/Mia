import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  Easing,
  interpolate,
  type DerivedValue,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '@/theme';

// The auth hero: Mia's orb, breathing, with a slowly spinning brand ring and
// voice-like ripples. `pulse` is bumped by the screen on every keystroke so
// the orb visibly "listens" while the user types. `scale` sizes the whole
// stage (1 = full 190pt stage); the parent owns visibility.

export const ORB_STAGE = 190; // full-size stage (glow + ripples)
const STAGE = ORB_STAGE;
export const ORB_RING = 116;
const RING = ORB_RING;
const CORE = 94;

type Props = {
  scale: DerivedValue<number>;
  pulse: SharedValue<number>;
};

function Ripple({ delay }: { delay: number }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 3200, easing: Easing.out(Easing.quad) }), -1),
    );
  }, [reduced, delay, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.15, 1], [0, 0.5, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.92, 1.6]) }],
  }));

  return <Reanimated.View style={[styles.ripple, style]} />;
}

export const HeroOrb = React.memo(function HeroOrb({ scale, pulse }: Props) {
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    spin.value = withRepeat(
      withTiming(360, { duration: 9000, easing: Easing.linear }),
      -1,
    );
    breathe.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduced, spin, breathe]);

  // Fixed-size stage, scaled visually.
  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: (1 + breathe.value * 0.045) * pulse.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.7 + breathe.value * 0.3,
    transform: [{ scale: 0.95 + (pulse.value - 1) * 2 + breathe.value * 0.08 }],
  }));

  return (
    <Reanimated.View style={[styles.stage, stageStyle]} pointerEvents="none">
      <Reanimated.View style={[styles.center, glowStyle]}>
        <Svg width={STAGE} height={STAGE}>
          <Defs>
            <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={colors.gradientMid} stopOpacity={0.55} />
              <Stop offset="50%" stopColor={colors.gradientStart} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={colors.gradientStart} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={STAGE / 2} cy={STAGE / 2} r={STAGE / 2} fill="url(#heroGlow)" />
        </Svg>
      </Reanimated.View>

      <View style={styles.center}>
        <Ripple delay={0} />
      </View>
      <View style={styles.center}>
        <Ripple delay={1600} />
      </View>

      {/* Spinning gradient ring: a rotating gradient disk under an opaque
          inner disk, leaving a thin luminous rim. */}
      <View style={styles.center}>
        <Reanimated.View style={[styles.ring, ringStyle]}>
          <LinearGradient
            colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd, 'rgba(109,59,245,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Reanimated.View>
        <View style={styles.ringMask} />
      </View>

      <View style={styles.center}>
        <Reanimated.View style={coreStyle}>
          <Svg width={CORE} height={CORE} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="heroCore" cx="36%" cy="32%" r="72%">
                <Stop offset="0%" stopColor="#ffb3cf" stopOpacity={1} />
                <Stop offset="28%" stopColor={colors.gradientMid} stopOpacity={1} />
                <Stop offset="72%" stopColor={colors.gradientStart} stopOpacity={1} />
                <Stop offset="100%" stopColor="#2a1470" stopOpacity={1} />
              </RadialGradient>
              <RadialGradient id="heroRim" cx="70%" cy="78%" r="40%">
                <Stop offset="0%" stopColor={colors.gradientEnd} stopOpacity={0.7} />
                <Stop offset="100%" stopColor={colors.gradientEnd} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="50" cy="50" r="48" fill="url(#heroCore)" />
            <Circle cx="50" cy="50" r="48" fill="url(#heroRim)" />
            <Circle cx="36" cy="32" r="11" fill="rgba(255,255,255,0.5)" />
            <Circle cx="31" cy="27" r="4" fill="rgba(255,255,255,0.85)" />
          </Svg>
        </Reanimated.View>
      </View>
    </Reanimated.View>
  );
});

const styles = StyleSheet.create({
  stage: {
    width: STAGE,
    height: STAGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    overflow: 'hidden',
  },
  ringMask: {
    position: 'absolute',
    width: RING - 5,
    height: RING - 5,
    borderRadius: (RING - 5) / 2,
    backgroundColor: colors.bgDeep,
  },
});
