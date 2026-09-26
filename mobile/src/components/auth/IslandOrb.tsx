import React, { useEffect } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';

import { HeroOrb, ORB_RING, ORB_STAGE } from './HeroOrb';

// A tiny Mia orb living in the status bar, in the gap between the clock and
// the Dynamic Island. On entry the island pushes out a black drop sideways
// that pinches off into a droplet and lights up as the orb.
//
// Other phones: Android parks it just left of the (usually centered) camera
// hole, dropping out of the camera; iPhones with a notch or no cutout have no
// free status-bar gap, so it sits at the top-left just under the status bar.

const DROP = 22; // parked orb ring diameter
const ORB_SCALE = DROP / ORB_RING;

type Rect = { x: number; y: number; w: number; h: number };
type Geometry = { start: Rect; orb: Rect };

/** Dynamic Island iPhones report a 59pt (14 Pro/15/16) or 62pt (16 Pro)
 *  top inset; the island is ~126×37pt, 11–14pt from the top, and the clock
 *  is centered in the strip left of it. None of this is queryable, so it's
 *  derived from the inset. */
function useGeometry(): Geometry {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const mid = width / 2;
  const square = (cx: number, cy: number, d: number): Rect => ({
    x: cx - d / 2,
    y: cy - d / 2,
    w: d,
    h: d,
  });

  if (Platform.OS === 'ios' && insets.top >= 59) {
    const island: Rect = { x: mid - 63, y: insets.top >= 62 ? 14 : 11, w: 126, h: 37 };
    const clockRight = island.x / 2 + 24; // "9:41" ≈ 48pt wide, centered in the strip
    const cx = (clockRight + island.x) / 2 + 4; // nudged toward the island
    return { start: island, orb: square(cx, island.y + island.h / 2, DROP) };
  }
  if (Platform.OS === 'android') {
    const cy = insets.top / 2;
    return { start: square(mid, cy, 12), orb: square(mid - 36, cy, DROP) };
  }
  const orb = square(spacing.xl + DROP / 2, insets.top + 10 + DROP / 2, DROP);
  return { start: square(orb.x + DROP / 2, orb.y + DROP / 2, 6), orb };
}

const lerp = (a: number, b: number, k: number) => {
  'worklet';
  return a + (b - a) * k;
};

export function IslandOrb({ pulse }: { pulse: SharedValue<number> }) {
  const { start: S, orb: O } = useGeometry();
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(700, withTiming(1, { duration: 900, easing: Easing.bezier(0.6, 0, 0.3, 1) }));
  }, [t]);

  // A pill spanning the start shape and the orb, as thick as the drop.
  const U: Rect = {
    x: Math.min(S.x, O.x),
    y: O.y,
    w: Math.max(S.x + S.w, O.x + O.w) - Math.min(S.x, O.x),
    h: O.h,
  };

  const orbScale = useDerivedValue(() =>
    interpolate(t.value, [0.62, 1], [0, ORB_SCALE], 'clamp'),
  );
  const orbStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.62, 0.8], [0, 1], 'clamp'),
  }));

  const dropStyle = useAnimatedStyle(() => {
    // 0 → 0.45: the start shape stretches toward the orb's spot, thinning to
    // the drop's thickness. 0.45 → 0.8: its far end lets go and it pinches
    // into a droplet. 0.72 → 1: it fades as the orb lights up inside it.
    const a = interpolate(t.value, [0, 0.45], [0, 1], 'clamp');
    const b = interpolate(t.value, [0.45, 0.8], [0, 1], 'clamp');
    const x = b > 0 ? lerp(U.x, O.x, b) : lerp(S.x, U.x, a);
    const y = b > 0 ? lerp(U.y, O.y, b) : lerp(S.y, U.y, a);
    const w = b > 0 ? lerp(U.w, O.w, b) : lerp(S.w, U.w, a);
    const h = b > 0 ? lerp(U.h, O.h, b) : lerp(S.h, U.h, a);
    return {
      left: x,
      top: y,
      width: w,
      height: h,
      borderRadius: Math.min(w, h) / 2,
      opacity: interpolate(t.value, [0, 0.02, 0.72, 1], [0, 1, 1, 0], 'clamp'),
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Reanimated.View style={[styles.drop, dropStyle]} />
      <Reanimated.View
        style={[
          styles.orb,
          { left: O.x + DROP / 2 - ORB_STAGE / 2, top: O.y + DROP / 2 - ORB_STAGE / 2 },
          orbStyle,
        ]}
      >
        <HeroOrb scale={orbScale} pulse={pulse} />
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  drop: {
    position: 'absolute',
    backgroundColor: '#000',
  },
  orb: {
    position: 'absolute',
    width: ORB_STAGE,
    height: ORB_STAGE,
  },
});
