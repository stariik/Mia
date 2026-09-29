import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/lib/haptics';
import { tickSound } from '@/lib/tickSound';
import { colors, fonts } from '@/theme';

// iPhone-style scroll wheel: rows snap to the centre band and fade out towards
// the edges. The rows are plain text and the fade is a static gradient laid on
// top, so scrolling stays entirely native — nothing is recalculated per frame.
// The only per-row work is the click; the chosen value is reported once the
// wheel comes to rest.

export const WHEEL_ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const SIDE_ITEMS = (VISIBLE_ITEMS - 1) / 2;
export const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * VISIBLE_ITEMS;

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

export const WheelPicker = memo(function WheelPicker({
  count,
  value,
  onChange,
  width = 64,
  fadeColor = colors.surfaceSolid,
  format = pad2,
}: Props) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const lastIndex = useSharedValue(value);
  // Remembers the value we reported, so a parent re-render with that same
  // value doesn't yank the wheel back.
  const reported = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Only the first render's offset: if this prop followed `value`, every
  // report back from the parent would jerk the wheel to that row mid-spin.
  const initialOffset = useRef({ x: 0, y: value * WHEEL_ITEM_HEIGHT }).current;

  const tick = useCallback(() => {
    if (!tickSound.play()) return;
    // Vibration on iOS is a long buzz, too heavy for a per-row tick.
    if (Platform.OS === 'android') haptics.selection();
  }, []);

  const commit = useCallback(() => {
    const index = lastIndex.value;
    if (index === reported.current) return;
    reported.current = index;
    onChangeRef.current(index);
  }, [lastIndex]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const index = Math.min(
        count - 1,
        Math.max(0, Math.round(e.contentOffset.y / WHEEL_ITEM_HEIGHT)),
      );
      if (index !== lastIndex.value) {
        lastIndex.value = index;
        scheduleOnRN(tick);
      }
    },
  });

  // Follow value changes that come from outside the wheel.
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    lastIndex.value = value;
    scrollRef.current?.scrollTo({ y: value * WHEEL_ITEM_HEIGHT, animated: true });
  }, [value, lastIndex, scrollRef]);

  // Closing mid-spin still keeps the row that was under the band.
  useEffect(() => commit, [commit]);

  const rows = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.item}>
          <Text style={styles.itemText}>{format(i)}</Text>
        </View>
      )),
    [count, format],
  );

  const clear = `${fadeColor}00`;

  return (
    <View style={{ width, height: WHEEL_HEIGHT }}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={commit}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="normal"
        overScrollMode="never"
        contentOffset={initialOffset}
        onLayout={() =>
          scrollRef.current?.scrollTo({
            y: reported.current * WHEEL_ITEM_HEIGHT,
            animated: false,
          })
        }
        contentContainerStyle={styles.content}
      >
        {rows}
      </Animated.ScrollView>
      {/* Plain wrappers own pointerEvents so the fades never swallow a drag. */}
      <View style={[styles.fade, styles.fadeTop]}>
        <LinearGradient colors={[fadeColor, clear]} style={styles.fill} />
      </View>
      <View style={[styles.fade, styles.fadeBottom]}>
        <LinearGradient colors={[clear, fadeColor]} style={styles.fill} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingVertical: WHEEL_ITEM_HEIGHT * SIDE_ITEMS,
  },
  item: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
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
    pointerEvents: 'none',
  },
  fill: { flex: 1 },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
});
