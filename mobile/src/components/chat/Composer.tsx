import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { ZoomIn, ZoomOut, useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { HIT, brandGradient, colors, radius, spacing, typography } from '@/theme';

// The text field, always in view at the bottom of the conversation. Its one
// button changes with what you'd want next:
//   empty      → a mic in the orb's colours (talk instead — same as the orb)
//   mic open   → stop
//   text typed → send, in the same colours
// The field's hairline warms to pink while it has focus.

type Action = 'mic' | 'stop' | 'send';

export function Composer({
  value,
  onChangeText,
  onSend,
  onMic,
  micActive,
  onFocus,
  placeholder,
  inputRef,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  /** Start or stop talking — the same as tapping the orb. */
  onMic: () => void;
  /** The mic is open (listening). */
  micActive: boolean;
  /** The field got focus — the screen opens its typing mode. */
  onFocus?: () => void;
  placeholder: string;
  /** Lets the screen focus the field (tapping the conversation does). */
  inputRef: React.RefObject<TextInput | null>;
}) {
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    // Android's back button closes the keyboard but leaves focus behind.
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      inputRef.current?.blur();
    });
    return () => sub.remove();
  }, [inputRef]);

  const hasText = value.trim().length > 0;
  const action: Action = hasText ? 'send' : micActive ? 'stop' : 'mic';
  const onAction = action === 'send' ? onSend : onMic;
  const label =
    action === 'send' ? 'გაგზავნა' : action === 'stop' ? 'მოსმენის შეწყვეტა' : 'ხმით საუბარი';

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
          onSubmitEditing={() => hasText && onSend()}
          style={styles.input}
          accessibilityLabel={placeholder}
        />
        <Pressable
          onPress={onAction}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Animated.View
            key={action}
            entering={reduceMotion ? undefined : ZoomIn.duration(180)}
            exiting={reduceMotion ? undefined : ZoomOut.duration(120)}
            style={styles.actionInner}
          >
            {action === 'stop' ? (
              <View style={[StyleSheet.absoluteFill, styles.stopFill]} />
            ) : (
              <LinearGradient
                colors={[...brandGradient]}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            )}
            {/* Explicitly above the fill: some renderers paint absolutely
                positioned siblings over in-flow ones. */}
            <View style={styles.glyph}>
              <Icon
                name={action}
                size={18}
                strokeWidth={2}
                color={action === 'stop' ? colors.primary : colors.primaryOn}
              />
            </View>
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const ACTION = 38;

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
    paddingRight: (HIT + 6 - ACTION) / 2,
    paddingVertical: (HIT + 6 - ACTION) / 2,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
    gap: spacing.sm,
  },
  fieldFocused: {
    borderColor: 'rgba(255,77,139,0.55)',
  },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    maxHeight: 132,
    minHeight: ACTION,
    paddingTop: 8,
    paddingBottom: 7,
    paddingHorizontal: 0,
    textAlignVertical: 'center',
  },
  action: {
    width: ACTION,
    height: ACTION,
  },
  actionInner: {
    width: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopFill: {
    backgroundColor: 'rgba(255,77,139,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,139,0.6)',
    borderRadius: ACTION / 2,
  },
  glyph: { zIndex: 1 },
  pressed: { opacity: 0.8 },
});
