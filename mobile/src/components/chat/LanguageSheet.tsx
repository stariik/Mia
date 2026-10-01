import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import {
  TRANSLATE_LANGUAGES,
  TRANSLATOR_LANGS,
  type Lang,
} from '@/lib/translateLanguages';
import { colors, duration, easeOut, radius, spacing, typography } from '@/theme';

export type LanguageSide = 'from' | 'to';

const TITLE: Record<LanguageSide, string> = {
  from: 'რომელ ენაზე ილაპარაკებ?',
  to: 'რომელ ენაზე ვთარგმნო?',
};

/** Language picker: English and Georgian lead, the rest follow a hairline. */
export function LanguageSheet({
  side,
  current,
  onPick,
  onClose,
}: {
  side: LanguageSide | null;
  current: Lang;
  onPick: (lang: Lang) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  return (
    <Modal
      visible={side !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={onClose}
        accessibilityLabel="დახურვა"
      />
      <Animated.View
        entering={
          reduceMotion
            ? undefined
            : SlideInDown.duration(duration.slow).easing(easeOut)
        }
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        accessibilityViewIsModal
      >
        <Text style={styles.title} accessibilityRole="header">
          {side ? TITLE[side] : ''}
        </Text>
        {TRANSLATOR_LANGS.map((code, i) => {
          const on = code === current;
          const names = TRANSLATE_LANGUAGES[code];
          return (
            <React.Fragment key={code}>
              {i === 2 ? <View style={styles.rule} /> : null}
              <Pressable
                onPress={() => onPick(code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={names.ka}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Text style={[styles.name, on && styles.nameOn]}>{names.ka}</Text>
                <Text style={styles.native}>{names.en}</Text>
                {on ? (
                  <Icon name="check" size={20} color={colors.primary} strokeWidth={2} />
                ) : (
                  <View style={styles.checkSpace} />
                )}
              </Pressable>
            </React.Fragment>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: colors.scrim,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    gap: spacing.md,
  },
  pressed: { opacity: 0.6 },
  name: {
    ...typography.bodyMedium,
    fontSize: 16,
    color: colors.text,
  },
  nameOn: { color: colors.primary },
  native: {
    ...typography.caption,
    color: colors.textFaint,
    flex: 1,
  },
  checkSpace: { width: 20 },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.stroke,
    marginVertical: spacing.xs,
  },
});
