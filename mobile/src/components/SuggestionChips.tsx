import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';

// First-run discovery: one example per core capability (weather, timer,
// alarm, music) so a new user immediately learns what Mia can do. Each chip
// carries a soft capability tint ("r,g,b") for its icon and hairline.
type Suggestion = {
  text: string;
  icon: 'weather' | 'timer' | 'alarm' | 'music';
  tint: string;
};

const SUGGESTIONS: Suggestion[] = [
  { text: 'რა ამინდია დღეს?', icon: 'weather', tint: '255,210,138' },
  { text: 'დააყენე ტაიმერი 5 წუთზე', icon: 'timer', tint: '185,167,255' },
  { text: 'გამაღვიძე ხვალ დილის 8 საათზე', icon: 'alarm', tint: '255,138,179' },
  { text: 'ჩართე მუსიკა', icon: 'music', tint: '255,165,125' },
];

const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;

function ChipIcon({ icon, color }: { icon: Suggestion['icon']; color: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (icon) {
    case 'weather':
      return (
        <Svg {...common}>
          <Circle cx="12" cy="12" r="4.2" />
          <Path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </Svg>
      );
    case 'timer':
      return (
        <Svg {...common}>
          <Path d="M10 2h4" />
          <Path d="M12 14l2.6-2.6" />
          <Circle cx="12" cy="14" r="7.5" />
        </Svg>
      );
    case 'alarm':
      return (
        <Svg {...common}>
          <Path d="M5 4l-2 2" />
          <Path d="M19 4l2 2" />
          <Circle cx="12" cy="13" r="7.5" />
          <Path d="M12 9.5v3.5l2.2 1.5" />
        </Svg>
      );
    case 'music':
      return (
        <Svg {...common}>
          <Path d="M9 18V5l12-2v13" />
          <Circle cx="6" cy="18" r="3" />
          <Circle cx="18" cy="16" r="3" />
        </Svg>
      );
  }
}

type Props = {
  onPick: (text: string) => void;
};

/** Tappable example prompts, shown only while the conversation is empty. */
export function SuggestionChips({ onPick }: Props) {
  return (
    <View style={styles.wrap}>
      <Animated.Text entering={FadeInDown.duration(300)} style={styles.title}>
        სცადე
      </Animated.Text>
      <View style={styles.chips}>
        {SUGGESTIONS.map((s, i) => (
          <Animated.View
            key={s.text}
            entering={FadeInDown.delay(80 + i * 70).duration(320)}
          >
            <Pressable
              onPress={() => {
                haptics.tap();
                onPick(s.text);
              }}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: rgba(s.tint, pressed ? 0.5 : 0.24),
                  backgroundColor: rgba(s.tint, pressed ? 0.13 : 0.05),
                },
                pressed && styles.chipPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={s.text}
            >
              {({ pressed }) => (
                <>
                  <ChipIcon icon={s.icon} color={rgba(s.tint, 0.95)} />
                  <Text style={[styles.chipText, pressed && styles.chipTextPressed]}>
                    {s.text}
                  </Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.lg,
  },
  title: {
    fontFamily: 'MarkGEO-CAPS',
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: colors.outline,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipPressed: {
    transform: [{ scale: 0.97 }],
  },
  chipText: {
    fontFamily: 'Manrope-Regular',
    fontSize: 12.5,
    color: colors.textMuted,
  },
  chipTextPressed: {
    color: colors.text,
  },
});
