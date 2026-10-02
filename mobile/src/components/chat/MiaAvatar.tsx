import React, { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '@/theme';

// Mia's face in the conversation: a tiny glass marble in the orb's own light
// (coral core → pink → violet rim, one soft highlight). Drawn once as static
// SVG; while Mia is talking a halo breathes around it — only that halo's
// scale and opacity move, on the UI thread.

export function MiaAvatar({ size = 24, live = false }: { size?: number; live?: boolean }) {
  const id = `mia${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!live || reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = withTiming(live ? 0.6 : 0, { duration: 300 });
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [live, reduceMotion, pulse]);

  const halo = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.55,
    transform: [{ scale: 1 + pulse.value * 0.45 }],
  }));

  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          { width: size, height: size, borderRadius: size / 2 },
          halo,
        ]}
      />
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <RadialGradient id={`${id}b`} cx="0.58" cy="0.62" r="0.62">
            <Stop offset="0" stopColor={colors.gradientEnd} />
            <Stop offset="0.45" stopColor={colors.gradientMid} />
            <Stop offset="1" stopColor={colors.gradientStart} />
          </RadialGradient>
          <RadialGradient id={`${id}h`} cx="0.36" cy="0.3" r="0.3">
            <Stop offset="0" stopColor={colors.primarySoft} stopOpacity={0.9} />
            <Stop offset="1" stopColor={colors.primarySoft} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="12" cy="12" r="11" fill={`url(#${id}b)`} />
        <Circle cx="12" cy="12" r="11" fill={`url(#${id}h)`} />
        <Circle
          cx="12"
          cy="12"
          r="10.6"
          fill="none"
          stroke={colors.secondarySoft}
          strokeOpacity={0.35}
          strokeWidth={0.8}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
    backgroundColor: colors.gradientMid,
  },
});
