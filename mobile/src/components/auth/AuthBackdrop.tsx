import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '@/theme';

// Three soft brand-colored light pools drifting on the navy, plus a faint
// field of twinkling specks. Everything is pointer-transparent and slow
// enough to read as "alive" without pulling focus from the form.

type BlobProps = {
  color: string;
  size: number;
  x: number;
  y: number;
  drift: number;
  duration: number;
  id: string;
};

function Blob({ color, size, x, y, drift, duration, id }: BlobProps) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduced, duration, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: t.value * drift },
      { translateY: -t.value * drift * 0.7 },
      { scale: 1 + t.value * 0.12 },
    ],
  }));

  return (
    <Reanimated.View
      style={[
        styles.blob,
        { width: size, height: size, left: x - size / 2, top: y - size / 2 },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.55} />
            <Stop offset="45%" stopColor={color} stopOpacity={0.18} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Reanimated.View>
  );
}

function Speck({ x, y, r, delay }: { x: number; y: number; r: number; delay: number }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(0.15);

  useEffect(() => {
    if (reduced) return;
    o.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.8, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.12, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, [reduced, delay, o]);

  const style = useAnimatedStyle(() => ({ opacity: o.value }));

  return (
    <Reanimated.View
      style={[
        styles.speck,
        { left: x, top: y, width: r * 2, height: r * 2, borderRadius: r },
        style,
      ]}
    />
  );
}

export const AuthBackdrop = React.memo(function AuthBackdrop() {
  const { width, height } = useWindowDimensions();

  // Deterministic pseudo-random layout so specks don't jump on re-render.
  const specks = useMemo(() => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    return Array.from({ length: 16 }, (_, i) => ({
      key: i,
      x: rand() * width,
      y: rand() * height,
      r: 0.8 + rand() * 1.2,
      delay: Math.round(rand() * 3000),
    }));
  }, [width, height]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[colors.bg, colors.bgDeep, colors.bgDeep]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Blob
        id="bViolet"
        color={colors.gradientStart}
        size={width * 1.25}
        x={width * 0.1}
        y={height * 0.12}
        drift={36}
        duration={9000}
      />
      <Blob
        id="bPink"
        color={colors.gradientMid}
        size={width * 0.95}
        x={width * 0.95}
        y={height * 0.42}
        drift={-30}
        duration={11000}
      />
      <Blob
        id="bCoral"
        color={colors.gradientEnd}
        size={width * 0.9}
        x={width * 0.2}
        y={height * 0.95}
        drift={26}
        duration={13000}
      />
      {specks.map(({ key, ...s }) => (
        <Speck key={key} {...s} />
      ))}
      {/* Vignette keeps the form area calm and legible. */}
      <LinearGradient
        colors={['rgba(10,11,22,0)', 'rgba(10,11,22,0.55)']}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    opacity: 0.55,
  },
  speck: {
    position: 'absolute',
    backgroundColor: '#ffffff',
  },
});
