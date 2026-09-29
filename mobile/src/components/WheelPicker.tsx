import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { tickSound } from '@/lib/tickSound';
import { colors, fonts } from '@/theme';

// iPhone-style scroll wheel that runs entirely on the UI thread.
//
// The finger, the fling and the settle all drive one shared number (`offset`,
// in rows) through a gesture handler and a spring — no ScrollView and no JS in
// the loop — and that number moves a single column of plain rows with one
// transform. So the only per-frame work is one translate, however fast the
// wheel spins. Like the iOS timer it loops: 59 sits right above 00.
//
// JS hears about it only for the click as each row passes the centre, and
// once, with the final number, when the wheel comes to rest.
//
// Must sit under a GestureHandlerRootView (WheelPopover provides one, since an
// RN <Modal> is outside the app's root view).

export const WHEEL_ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const SIDE_ITEMS = (VISIBLE_ITEMS - 1) / 2;
export const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * VISIBLE_ITEMS;
// Extra rows above and below one full lap, so the edges never show a gap.
const BUFFER = SIDE_ITEMS + 1;

// How far ahead (seconds) a fling's speed is projected to pick where it stops.
const FLING_PROJECTION_S = 0.32;
const SETTLE_SPRING = { damping: 30, stiffness: 240, mass: 1 };

type Props = {
  count: number;
  value: number;
  onChange: (value: number) => void;
  width?: number;
  /** Background the wheel sits on (6-digit hex); the edge fade blends into it. */
  fadeColor?: string;
  format?: (n: number) => string;
};

const pad2 = (n: number) => n.toString().padStart(2, '0');

function wrap(n: number, count: number) {
  'worklet';
  return ((n % count) + count) % count;
}

export const WheelPicker = memo(function WheelPicker({
  count,
  value,
  onChange,
  width = 64,
  fadeColor = colors.surfaceSolid,
  format = pad2,
}: Props) {
  const offset = useSharedValue(value);
  const dragStart = useSharedValue(0);
  // Remembers the value we reported, so a parent re-render with that same
  // value doesn't move the wheel.
  const reported = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = useCallback((v: number) => {
    if (v === reported.current) return;
    reported.current = v;
    onChangeRef.current(v);
  }, []);

  const settleTo = (target: number, velocity: number) => {
    'worklet';
    offset.value = withSpring(
      target,
      { ...SETTLE_SPRING, velocity },
      finished => {
        if (finished) scheduleOnRN(commit, wrap(target, count));
      },
    );
  };

  const gesture = Gesture.Pan()
    // Active from the first touch, so a touch stops a spinning wheel dead.
    .minDistance(0)
    .onStart(() => {
      cancelAnimation(offset);
      dragStart.value = offset.value;
    })
    .onUpdate(e => {
      // Dragging down brings the smaller numbers above into the centre.
      offset.value = dragStart.value - e.translationY / WHEEL_ITEM_HEIGHT;
    })
    .onEnd(e => {
      const rowsPerSec = -e.velocityY / WHEEL_ITEM_HEIGHT;
      const isTap = Math.abs(e.translationY) < 6 && Math.abs(rowsPerSec) < 1.5;
      if (isTap) {
        // Tapping a row above or below rolls it into the centre.
        const rowsFromCentre = Math.round(
          (e.y - WHEEL_HEIGHT / 2) / WHEEL_ITEM_HEIGHT,
        );
        settleTo(Math.round(offset.value) + rowsFromCentre, 0);
        return;
      }
      settleTo(
        Math.round(offset.value + rowsPerSec * FLING_PROJECTION_S),
        rowsPerSec,
      );
    });

  // One click per row that crosses the centre.
  const playTick = useCallback(() => tickSound.play(), []);
  useAnimatedReaction(
    () => Math.round(offset.value),
    (row, prev) => {
      if (prev !== null && row !== prev) scheduleOnRN(playTick);
    },
  );

  // Follow value changes that come from outside the wheel.
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    const current = Math.round(offset.value);
    let delta = wrap(value - current, count);
    if (delta > count / 2) delta -= count;
    offset.value = withSpring(current + delta, SETTLE_SPRING);
  }, [value, count, offset]);

  // Closing mid-spin still keeps the row that was under the band.
  useEffect(
    () => () => commit(wrap(Math.round(offset.value), count)),
    [commit, count, offset],
  );

  const rows = useMemo(
    () =>
      Array.from({ length: count + BUFFER * 2 }, (_, i) => (
        <Text key={i} style={styles.item}>
          {format(wrap(i - BUFFER, count))}
        </Text>
      )),
    [count, format],
  );

  const columnStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (SIDE_ITEMS - BUFFER - wrap(offset.value, count)) * WHEEL_ITEM_HEIGHT,
      },
    ],
  }));

  const clear = `${fadeColor}00`;

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.wheel, { width }]}>
        <Animated.View style={columnStyle}>{rows}</Animated.View>
        <View style={[styles.fade, styles.fadeTop]} pointerEvents="none">
          <LinearGradient colors={[fadeColor, clear]} style={styles.fill} />
        </View>
        <View style={[styles.fade, styles.fadeBottom]} pointerEvents="none">
          <LinearGradient colors={[clear, fadeColor]} style={styles.fill} />
        </View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  wheel: {
    height: WHEEL_HEIGHT,
    overflow: 'hidden',
  },
  item: {
    height: WHEEL_ITEM_HEIGHT,
    lineHeight: WHEEL_ITEM_HEIGHT,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    fontFamily: fonts.numeric,
    fontSize: 28,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WHEEL_ITEM_HEIGHT * SIDE_ITEMS,
  },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
  fill: { flex: 1 },
});
