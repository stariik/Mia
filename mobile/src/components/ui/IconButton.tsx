import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { HIT, colors, radius } from '@/theme';

import { Icon, type IconName } from './Icon';

/**
 * A quiet, square 44pt touch target holding one icon. No resting background —
 * only a faint wash while pressed — so controls recede until they're needed.
 */
export function IconButton({
  icon,
  label,
  onPress,
  onPressIn,
  color = colors.textMuted,
  size = 22,
  disabled,
  selected,
  style,
}: {
  icon: IconName;
  /** Screen-reader label (required — icon buttons have no visible text). */
  label: string;
  onPress: () => void;
  onPressIn?: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      style={({ pressed }) => [
        styles.btn,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: HIT,
    height: HIT,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.stroke },
  disabled: { opacity: 0.35 },
});
