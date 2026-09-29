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
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { WHEEL_HEIGHT, WHEEL_ITEM_HEIGHT, WheelPicker } from './WheelPicker';
import { colors, fonts, radius, spacing } from '@/theme';

// One scroll wheel that unfolds right on top of the field that was tapped, so
// the current number stays where the finger is and the rows around it open up
// and down. Tapping anywhere outside folds it away.

export type WheelAnchor = { x: number; y: number; width: number; height: number };

type Props = {
  anchor: WheelAnchor | null;
  unit: string;
  count: number;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
};

const CARD_PAD = spacing.sm;
const CARD_WIDTH = 120;
const CARD_HEIGHT = WHEEL_HEIGHT + CARD_PAD * 2;

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
    progress.value = withTiming(0, { duration: 150 }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scaleY: interpolate(progress.value, [0, 1], [0.35, 1]) }],
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
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View style={[styles.card, { left, top }, cardStyle]}>
        <View style={styles.band} pointerEvents="none" />
        <WheelPicker count={count} value={value} onChange={onChange} />
        <Text style={styles.unit}>{unit}</Text>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    padding: CARD_PAD,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.strokeBrand,
  },
  band: {
    position: 'absolute',
    top: CARD_PAD + (WHEEL_HEIGHT - WHEEL_ITEM_HEIGHT) / 2,
    left: CARD_PAD,
    right: CARD_PAD,
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.primaryGlow,
  },
  unit: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
});
