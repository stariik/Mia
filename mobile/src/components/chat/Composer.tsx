import React, { useEffect, useRef } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutDown,
  useReducedMotion,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { HIT, colors, duration, radius, spacing, typography } from '@/theme';

// The keyboard is a fallback, not a mode: there is no button for it. Tapping
// the conversation slides this in with the keyboard already up; when the
// keyboard goes away with nothing typed, it slides back out.

export function Composer({
  value,
  onChangeText,
  onSend,
  onDismiss,
  placeholder,
  busy,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  /** Keyboard closed with an empty field — hide me. */
  onDismiss: () => void;
  placeholder: string;
  /** A reply is in flight; typing is fine, sending waits. */
  busy?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      // Android's back button closes the keyboard but leaves focus behind.
      inputRef.current?.blur();
      if (!valueRef.current.trim()) onDismiss();
    });
    return () => sub.remove();
  }, [onDismiss]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(duration.base)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(duration.fast)}
      style={styles.bar}
    >
      <View style={styles.field}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          cursorColor={colors.primary}
          selectionColor={colors.primaryGlow}
          autoFocus
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={() => canSend && onSend()}
          style={styles.input}
          accessibilityLabel={placeholder}
        />
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="გაგზავნა"
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => [
            styles.send,
            canSend && styles.sendReady,
            pressed && styles.sendPressed,
          ]}
        >
          <Icon
            name="send"
            size={18}
            strokeWidth={2}
            color={canSend ? colors.primaryOn : colors.textFaint}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const SEND = 36;

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.bgDeep,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: HIT + 4,
    paddingLeft: spacing.lg,
    paddingRight: (HIT + 4 - SEND) / 2,
    paddingVertical: (HIT + 4 - SEND) / 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    maxHeight: 132,
    minHeight: SEND,
    paddingTop: 7,
    paddingBottom: 6,
    paddingHorizontal: 0,
    textAlignVertical: 'center',
  },
  send: {
    width: SEND,
    height: SEND,
    borderRadius: SEND / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendReady: { backgroundColor: colors.primary },
  sendPressed: { opacity: 0.8 },
});
