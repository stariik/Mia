import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { HIT, colors, radius, spacing, typography } from '@/theme';

// The text field, always in view at the bottom of the conversation, with one
// send button: quiet while the field is empty, pink once there's something
// to send. Voice stays on the orb. The field's hairline warms on focus.

export function Composer({
  value,
  onChangeText,
  onSend,
  onFocus,
  placeholder,
  inputRef,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  /** The field got focus — the screen opens its typing mode. */
  onFocus?: () => void;
  placeholder: string;
  /** Lets the screen focus the field (tapping the conversation does). */
  inputRef: React.RefObject<TextInput | null>;
}) {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    // Android's back button closes the keyboard but leaves focus behind.
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      inputRef.current?.blur();
    });
    return () => sub.remove();
  }, [inputRef]);

  const canSend = value.trim().length > 0;

  return (
    <View style={styles.bar}>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          cursorColor={colors.primary}
          selectionColor={colors.primaryGlow}
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
            pressed && styles.pressed,
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
    </View>
  );
}

const SEND = 38;

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: HIT + 6,
    paddingLeft: spacing.lg,
    paddingRight: (HIT + 6 - SEND) / 2,
    paddingVertical: (HIT + 6 - SEND) / 2,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
    gap: spacing.sm,
  },
  fieldFocused: {
    borderColor: 'rgba(255,77,139,0.45)',
  },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    maxHeight: 132,
    minHeight: SEND,
    paddingTop: 8,
    paddingBottom: 7,
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
  pressed: { opacity: 0.8 },
});
