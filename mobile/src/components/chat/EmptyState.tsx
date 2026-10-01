import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type GestureResponderEvent,
} from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { colors, duration, spacing, typography } from '@/theme';

// First thing a new (or returning) user reads under the orb: a greeting for
// the time of day, how to talk to Mia, and a few things worth saying — one per
// voice-only capability, since they no longer have buttons. Tapping one says
// it for you.

const EXAMPLES = [
  'რა ამინდია დღეს?',
  'დამიყენე ტაიმერი ათ წუთზე',
  'გამაღვიძე ხვალ დილის შვიდზე',
  'თარგმნე ინგლისურად',
];

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return 'დილა მშვიდობისა';
  if (hour >= 18 && hour < 23) return 'საღამო მშვიდობისა';
  return 'გამარჯობა';
}

export function EmptyState({
  onSuggestion,
  bottomPadding,
  touchProps,
  onControlPressIn,
}: {
  onSuggestion: (text: string) => void;
  bottomPadding: number;
  /** Tap-to-type on the empty space (see useTapToCompose). */
  touchProps: {
    onTouchStart: (e: GestureResponderEvent) => void;
    onTouchEnd: (e: GestureResponderEvent) => void;
  };
  onControlPressIn: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const hello = useMemo(() => greeting(new Date().getHours()), []);
  const enter = (i: number) =>
    reduceMotion ? undefined : FadeIn.delay(80 + i * 60).duration(duration.slow);

  return (
    // Scrolls only on short screens, where the examples don't all fit.
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.wrap,
        { paddingBottom: bottomPadding + spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...touchProps}
    >
      <Animated.Text entering={enter(0)} style={styles.hello} accessibilityRole="header">
        {hello}
      </Animated.Text>
      <Animated.Text entering={enter(1)} style={styles.lead}>
        შეეხე სფეროს და ილაპარაკე — ან თქვი „Mia“.
      </Animated.Text>

      <Animated.View entering={enter(2)} style={styles.examples}>
        <Text style={styles.label}>სცადე</Text>
        {EXAMPLES.map((e) => (
          <Pressable
            key={e}
            onPressIn={onControlPressIn}
            onPress={() => onSuggestion(e)}
            accessibilityRole="button"
            accessibilityHint="Mia-ს ეს გაეგზავნება"
            style={({ pressed }) => [styles.example, pressed && styles.pressed]}
          >
            <Text style={styles.exampleText}>„{e}“</Text>
          </Pressable>
        ))}
      </Animated.View>

      <Animated.Text entering={enter(3)} style={styles.typeHint}>
        დასაწერად შეეხე ცარიელ ადგილს
      </Animated.Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  hello: {
    ...typography.display,
    color: colors.text,
  },
  lead: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  examples: {
    marginTop: spacing.xl,
  },
  label: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.xs,
  },
  example: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.6 },
  exampleText: {
    ...typography.body,
    color: colors.text,
  },
  typeHint: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: 'auto',
    paddingTop: spacing.lg,
  },
});
