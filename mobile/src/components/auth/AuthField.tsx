import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import Reanimated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

import { colors, fonts, radius, spacing } from '@/theme';

import { CheckIcon, EyeIcon, type IconName, FieldIcon } from './icons';

// Floating-label input: the label rests inside the field like a placeholder
// and glides up into a caption as soon as the field is focused or filled.
// The border warms from hairline to brand pink on focus, red on error.

type Props = Omit<TextInputProps, 'style' | 'secureTextEntry'> & {
  label: string;
  icon: IconName;
  value: string;
  secure?: boolean;
  valid?: boolean;
  invalid?: boolean;
};

const HEIGHT = 56;

export const AuthField = forwardRef<TextInput, Props>(function AuthField(
  { label, icon, value, secure, valid, invalid, onFocus, onBlur, ...input },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const focus = useSharedValue(0);
  const lifted = useSharedValue(value ? 1 : 0);
  const danger = useSharedValue(0);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: 200 });
    lifted.value = withTiming(focused || value.length > 0 ? 1 : 0, { duration: 200 });
  }, [focused, value, focus, lifted]);

  useEffect(() => {
    danger.value = withTiming(invalid ? 1 : 0, { duration: 200 });
  }, [invalid, danger]);

  const boxStyle = useAnimatedStyle(() => {
    const base = interpolateColor(focus.value, [0, 1], [colors.stroke, colors.primary]);
    return {
      borderColor: interpolateColor(danger.value, [0, 1], [base as string, colors.danger]),
      backgroundColor: interpolateColor(
        focus.value,
        [0, 1],
        ['rgba(0,0,0,0.28)', 'rgba(255,77,139,0.06)'],
      ),
      shadowOpacity: focus.value * 0.45,
    };
  });

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(lifted.value, [0, 1], [0, -11]) },
      { scale: interpolate(lifted.value, [0, 1], [1, 0.76]) },
    ],
    color: interpolateColor(
      focus.value,
      [0, 1],
      [colors.textMuted, colors.primarySoft],
    ),
  }));


  const iconColor = invalid ? colors.danger : focused ? colors.primary : colors.outline;

  // The TextInput is always fully visible and in normal flow — a transparent
  // (opacity 0) input can drop taps, so it never focused. Tapping
  // anywhere else on the box (icon, padding) focuses it too.
  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessible={false}>
      <Reanimated.View style={[styles.box, boxStyle]}>
        <View style={styles.icon}>
          <FieldIcon name={icon} color={iconColor} />
        </View>

        <View style={styles.body}>
          <View style={styles.labelWrap} pointerEvents="none">
            <Reanimated.Text numberOfLines={1} style={[styles.label, labelStyle]}>
              {label}
            </Reanimated.Text>
          </View>
          <TextInput
            ref={inputRef}
            {...input}
            value={value}
            secureTextEntry={secure && !reveal}
            style={styles.input}
            placeholderTextColor={colors.outline}
            selectionColor={colors.primary}
            cursorColor={colors.primary}
            accessibilityLabel={label}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
          />
        </View>

        {valid ? (
          <Reanimated.View entering={ZoomIn.springify().damping(12)} exiting={ZoomOut.duration(150)} style={styles.trailing}>
            <CheckIcon color={colors.success} />
          </Reanimated.View>
        ) : null}
  
        {secure ? (
          <Pressable
            onPress={() => setReveal((v) => !v)}
            hitSlop={12}
            style={styles.trailing}
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'პაროლის დამალვა' : 'პაროლის ჩვენება'}
          >
            <EyeIcon open={reveal} color={reveal ? colors.primary : colors.outline} />
          </Pressable>
        ) : null}
      </Reanimated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  box: {
    height: HEIGHT,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
  },
  icon: {
    width: 22,
    alignItems: 'center',
    marginRight: spacing.md,
  },
  body: {
    flex: 1,
    height: '100%',
  },
  labelWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 15,
    transformOrigin: 'left center',
  },
  // Text sits below the lifted label: top padding pushes it into the lower
  // half of the 56px box.
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    paddingTop: 16,
    paddingBottom: 0,
    paddingHorizontal: 0,
    textAlignVertical: 'center',
  },
  trailing: {
    marginLeft: spacing.sm,
  },
});
