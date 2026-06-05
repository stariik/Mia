import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

type Props = {
  /** Disables motion. Useful on screens where the orb is hero (Home, Auth). */
  still?: boolean;
};

/**
 * Cosmic backdrop shared by every screen.
 *
 * Base: deep navy → black vertical gradient.
 * Overlays: two large soft cyan/violet blobs slowly drifting on independent
 *           cycles to give a subtle aurora feel. Pure visual — no events.
 */
export function AuroraBackdrop({ still = false }: Props) {
  const driftA = useSharedValue(0);
  const driftB = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    driftA.value = withRepeat(
      withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    driftB.value = withRepeat(
      withTiming(1, { duration: 19000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(driftA);
      cancelAnimation(driftB);
    };
  }, [still, driftA, driftB]);

  const cyanStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -80 + driftA.value * 160 },
      { translateY: -40 + driftA.value * 80 },
      { scale: 0.95 + driftA.value * 0.15 },
    ],
    opacity: 0.55 + driftA.value * 0.25,
  }));

  const violetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: 80 - driftB.value * 160 },
      { translateY: 60 - driftB.value * 80 },
      { scale: 0.9 + driftB.value * 0.2 },
    ],
    opacity: 0.45 + driftB.value * 0.3,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[colors.bg, colors.bgDeep]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.blob, styles.cyan, cyanStyle]} />
      <Animated.View style={[styles.blob, styles.violet, violetStyle]} />
      {/* Subtle vignette so content reads cleanly at the edges */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.45)']}
        start={{ x: 0.5, y: 0.4 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
  },
  cyan: {
    top: -120,
    left: -120,
    backgroundColor: colors.auroraCyan,
  },
  violet: {
    bottom: -160,
    right: -100,
    backgroundColor: colors.auroraViolet,
  },
});
