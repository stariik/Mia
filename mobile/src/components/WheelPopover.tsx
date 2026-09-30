import React, { useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { WHEEL_HEIGHT, WHEEL_ITEM_HEIGHT, WheelPicker } from './WheelPicker';
import { colors, fonts, radius, spacing } from '@/theme';

// One scroll wheel that unfolds right on top of the field that was tapped, so
// the current number stays where the finger is and the rows around it open up
// and down. Tapping anywhere outside folds it away.

export type WheelAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  anchor: WheelAnchor | null;
  unit: string;
  count: number;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
};

const BORDER = 1;
const CARD_WIDTH = 132;
const CARD_HEIGHT = WHEEL_HEIGHT + BORDER * 2;
const BAND_TOP = (WHEEL_HEIGHT - WHEEL_ITEM_HEIGHT) / 2;

export function WheelPopover({
  anchor,
  unit,
  count,
  value,
  onChange,
  onClose,
}: Props) {
  const progress = useSharedValue(0);
  const screen = useWindowDimensions();

  useEffect(() => {
    if (anchor) progress.value = withTiming(1, { duration: 200 });
  }, [anchor, progress]);

  const close = () => {
    progress.value = withTiming(0, { duration: 150 }, finished => {
      if (finished) scheduleOnRN(onClose);
    });
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // Fade only, no scale: on Android the touch area kept the scale the card
  // started at, so only a strip around the middle row could be dragged.
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  if (!anchor) return null;

  // Centred on the field, but kept on screen near the top and bottom edges.
  const left = anchor.x + anchor.width / 2 - CARD_WIDTH / 2;
  const top = Math.min(
    Math.max(spacing.xl, anchor.y + anchor.height / 2 - CARD_HEIGHT / 2),
    screen.height - CARD_HEIGHT - spacing.xl,
  );

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      {/* A Modal is its own window, outside the app's root view, so the
          wheel's gesture needs a root of its own here. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <Animated.View style={[styles.card, { left, top }, cardStyle]}>
          <View style={styles.band} pointerEvents="none" />
          {/* The wheel spans the whole card, so a drag anywhere on it scrolls. */}
          <WheelPicker
            count={count}
            value={value}
            onChange={onChange}
            width={CARD_WIDTH - BORDER * 2}
          />
          <View style={styles.unitWrap} pointerEvents="none">
            <Text style={styles.unit}>{unit}</Text>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: BORDER,
    borderColor: colors.strokeBrand,
  },
  band: {
    position: 'absolute',
    top: BAND_TOP,
    left: spacing.xs,
    right: spacing.xs,
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.primaryGlow,
  },
  unitWrap: {
    position: 'absolute',
    top: BAND_TOP,
    right: spacing.md,
    height: WHEEL_ITEM_HEIGHT,
    justifyContent: 'center',
  },
  unit: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.textMuted,
  },
});
