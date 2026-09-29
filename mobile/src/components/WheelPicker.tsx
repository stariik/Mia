import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/lib/haptics';
import { colors, fonts } from '@/theme';

// iPhone-style scroll wheel: rows snap to the centre band, and rows further
// from the centre tilt away and fade out like the face of a drum.

export const WHEEL_ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const SIDE_ITEMS = (VISIBLE_ITEMS - 1) / 2;

type Props = {
  count: number;
  value: number;
  onChange: (value: number) => void;
  width?: number;
  format?: (n: number) => string;
};

const pad2 = (n: number) => n.toString().padStart(2, '0');

export function WheelPicker({
  count,
  value,
  onChange,
  width = 64,
  format = pad2,
}: Props) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(value * WHEEL_ITEM_HEIGHT);
  const lastIndex = useSharedValue(value);
  // Remembers the value we reported, so a parent re-render with that same
  // value doesn't yank the wheel back mid-scroll.
  const reported = useRef(value);

  const handleIndex = useCallback(
    (index: number) => {
      reported.current = index;
      // Vibration on iOS is a long buzz, too heavy for a per-row tick.
      if (Platform.OS === 'android') haptics.selection();
      onChange(index);
    },
    [onChange],
  );

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      const index = Math.min(
        count - 1,
        Math.max(0, Math.round(e.contentOffset.y / WHEEL_ITEM_HEIGHT)),
      );
      if (index !== lastIndex.value) {
        lastIndex.value = index;
        scheduleOnRN(handleIndex, index);
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

  const items = Array.from({ length: count }, (_, i) => i);

  return (
    <View style={{ width, height: WHEEL_ITEM_HEIGHT * VISIBLE_ITEMS }}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        contentOffset={{ x: 0, y: value * WHEEL_ITEM_HEIGHT }}
        onLayout={() =>
          scrollRef.current?.scrollTo({
            y: reported.current * WHEEL_ITEM_HEIGHT,
            animated: false,
          })
        }
        contentContainerStyle={{
          paddingVertical: WHEEL_ITEM_HEIGHT * SIDE_ITEMS,
        }}
      >
        {items.map((i) => (
          <WheelItem key={i} index={i} scrollY={scrollY} label={format(i)} />
        ))}
      </Animated.ScrollView>
    </View>
  );
}

function WheelItem({
  index,
  scrollY,
  label,
}: {
  index: number;
  scrollY: SharedValue<number>;
  label: string;
}) {
  const style = useAnimatedStyle(() => {
    const d = index - scrollY.value / WHEEL_ITEM_HEIGHT;
    const dist = Math.abs(d);
    return {
      opacity: interpolate(dist, [0, 1, 2, 3], [1, 0.5, 0.2, 0], 'clamp'),
      transform: [
        { perspective: 400 },
        { rotateX: `${interpolate(d, [-3, 0, 3], [60, 0, -60], 'clamp')}deg` },
        { scale: interpolate(dist, [0, 2], [1, 0.86], 'clamp') },
      ],
    };
  });

  return (
    <Animated.View style={[styles.item, style]}>
      <Text style={styles.itemText}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
});
