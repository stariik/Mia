import React, { useEffect } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { HIT, colors, radius, spacing, typography } from '@/theme';

// The text field, always in view at the bottom of the conversation so nobody
// has to look for where to type. Voice stays first (the orb); this is the
// quiet alternative right under it.

export function Composer({
  value,
  onChangeText,
  onSend,
  onFocus,
  placeholder,
  inputRef,
  busy,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  /** The field got focus — the screen opens its typing mode. */
  onFocus?: () => void;
  placeholder: string;
  /** Lets the screen focus the field (tapping the conversation does). */
  inputRef: React.RefObject<TextInput | null>;
  /** A reply is in flight; typing is fine, sending waits. */
  busy?: boolean;
}) {
  useEffect(() => {
    // Android's back button closes the keyboard but leaves focus behind.
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      inputRef.current?.blur();
    });
    return () => sub.remove();
  }, [inputRef]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <View style={styles.bar}>
      <View style={styles.field}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
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
    </View>
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
