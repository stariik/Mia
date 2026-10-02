import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Animated, { FadeIn, FadeInRight, useReducedMotion } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, duration, easeOut, radius, spacing, typography } from '@/theme';


// The first thing under the orb: a greeting for the time of day, then one
// card per thing Mia can do by voice. The cards are quiet surfaces; only each
// icon carries a touch of one of the orb's hues. Tapping a card says it for
// you. They scroll sideways, so short phones never overflow.

type Card = { icon: IconName; title: string; say: string; hue: string; ink: string };

const CARDS: Card[] = [
  { icon: 'sun', title: 'ამინდი', say: 'რა ამინდია დღეს?', hue: '255,107,61', ink: '#ffb59a' },
  { icon: 'timer', title: 'ტაიმერი', say: 'დამიყენე ტაიმერი ათ წუთზე', hue: '255,77,139', ink: '#ffa3c4' },
  { icon: 'alarm', title: 'მაღვიძარა', say: 'გამაღვიძე ხვალ დილის შვიდზე', hue: '109,59,245', ink: colors.secondarySoft },
  { icon: 'translate', title: 'თარჯიმანი', say: 'თარგმნე ინგლისურად', hue: '217,201,255', ink: colors.secondarySoft },
];

const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;

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
  /** Tapping empty space focuses the text field (see useTapToCompose). */
  touchProps: {
    onTouchStart: (e: GestureResponderEvent) => void;
    onTouchEnd: (e: GestureResponderEvent) => void;
  };
  onControlPressIn: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const hello = useMemo(() => greeting(new Date().getHours()), []);
  const fade = (i: number) =>
    reduceMotion ? undefined : FadeIn.delay(60 + i * 70).duration(duration.slow);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.wrap, { paddingBottom: bottomPadding + spacing.lg }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...touchProps}
    >
      <Animated.Text entering={fade(0)} style={styles.hello} accessibilityRole="header">
        {hello}
      </Animated.Text>
      <Animated.Text entering={fade(1)} style={styles.lead}>
        შეეხე სფეროს და ილაპარაკე, ან მომწერე ქვემოთ.
      </Animated.Text>

      <Animated.Text entering={fade(2)} style={styles.label}>
        სცადე
      </Animated.Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cards}
        style={styles.cardsScroll}
        keyboardShouldPersistTaps="handled"
      >
        {CARDS.map((c, i) => (
          <Animated.View
            key={c.title}
            entering={
              reduceMotion
                ? undefined
                : FadeInRight.delay(160 + i * 70).duration(duration.slow).easing(easeOut)
            }
          >
            <Pressable
              onPressIn={onControlPressIn}
              onPress={() => onSuggestion(c.say)}
              accessibilityRole="button"
              accessibilityLabel={`${c.title}: ${c.say}`}
              accessibilityHint="Mia-ს ეს გაეგზავნება"
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={[styles.cardIcon, { backgroundColor: rgba(c.hue, 0.14) }]}>
                <Icon name={c.icon} size={20} color={c.ink} strokeWidth={1.8} />
              </View>
              <Text style={styles.cardTitle}>{c.title}</Text>
              <Text style={styles.cardSay} numberOfLines={2}>
                „{c.say}“
              </Text>
            </Pressable>
          </Animated.View>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

const CARD_W = 164;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: {
    flexGrow: 1,
    paddingTop: spacing.xxl,
  },
  hello: {
    ...typography.display,
    color: colors.text,
    paddingHorizontal: spacing.xl,
  },
  lead: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  label: {
    ...typography.label,
    color: colors.textFaint,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  cardsScroll: { flexGrow: 0 },
  cards: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: CARD_W,
    minHeight: 132,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHigh,
    transform: [{ scale: 0.97 }],
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  cardSay: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
});
