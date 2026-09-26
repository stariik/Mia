import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { brandGradient, colors, fonts, radius } from '@/theme';

import { ArrowIcon } from './icons';

// Primary CTA: brand gradient with a glossy light sweep every few seconds,
// a springy press, and a label ↔ spinner crossfade while loading.

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  ready?: boolean;
};

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

export function GradientButton({ label, onPress, loading, ready = true }: Props) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const press = useSharedValue(0);
  const sweep = useSharedValue(0);
  const on = useSharedValue(ready ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(ready ? 1 : 0, { duration: 220 });
  }, [ready, on]);

  useEffect(() => {
    if (reduced || !ready || loading) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = withRepeat(
      withDelay(1400, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) })),
      -1,
    );
  }, [reduced, ready, loading, sweep]);

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.035 }],
    opacity: interpolate(on.value, [0, 1], [0.5, 1]),
    shadowOpacity: on.value * 0.55,
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(sweep.value, [0, 1], [-120, width + 40]) },
      { skewX: '-20deg' },
    ],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={loading}
      onPressIn={() => {
        press.value = withSpring(1, { damping: 20, stiffness: 400 });
      }}
      onPressOut={() => {
        press.value = withSpring(0, { damping: 12, stiffness: 260 });
      }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading }}
      style={[styles.btn, btnStyle]}
    >
      <LinearGradient
        colors={[...brandGradient]}
        start={{ x: 0, y: 0.2 }}
        end={{ x: 1, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Top gloss for a subtle glassy bevel */}
      <LinearGradient
        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.6 }}
        style={StyleSheet.absoluteFill}
      />
      <Reanimated.View style={[styles.sweep, sweepStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Reanimated.View>

      {loading ? (
        <Reanimated.View key="spin" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          <ActivityIndicator color="#fff" />
        </Reanimated.View>
      ) : (
        <Reanimated.View
          key={label}
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(60)}
          style={styles.row}
        >
          <Text style={styles.text}>{label}</Text>
          <View style={styles.arrow}>
            <ArrowIcon color="#fff" />
          </View>
        </Reanimated.View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: radius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
  sweep: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    left: 0,
    width: 70,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.primaryOn,
    letterSpacing: 0.3,
  },
  arrow: {
    marginLeft: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
