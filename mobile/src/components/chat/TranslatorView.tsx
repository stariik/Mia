import React, { memo, useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { copyText } from '@/lib/clipboard';
import { haptics } from '@/lib/haptics';
import {
  languageNameKa,
  languageNameKaAdverb,
  type Lang,
} from '@/lib/translateLanguages';
import { translator } from '@/lib/translator/session';
import {
  useTranslatorSession,
  type TranslationTurn,
} from '@/stores/translatorSessionStore';
import { useTranslatorStore } from '@/stores/translatorStore';
import { HIT, colors, duration, radius, spacing, typography } from '@/theme';

import { JumpToLatest } from './JumpToLatest';
import { LanguageSheet, type LanguageSide } from './LanguageSheet';
import { LiveLine } from './LiveLine';
import { useStickyScroll } from './useStickyScroll';

// Translator mode takes over the chat area. The language pair sits on top
// (from → to, with a swap), each turn shows what was said, quietly, above its
// translation set as the main reading text. Close (×) returns to the chat;
// so does saying "stop translating".

const name = (l: Lang) => languageNameKa(l) ?? l;

function LanguageChip({
  lang,
  side,
  onPress,
}: {
  lang: Lang;
  side: LanguageSide;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${side === 'from' ? 'საიდან' : 'სად'}: ${name(lang)}`}
      accessibilityHint="ენის შესაცვლელად"
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
    >
      <Text
        style={styles.chipText}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {name(lang)}
      </Text>
      <Icon name="chevronDown" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const Turn = memo(function Turn({
  turn,
  showPair,
  animate,
  onCompose,
  onCopied,
}: {
  turn: TranslationTurn;
  showPair: boolean;
  animate: boolean;
  onCompose: () => void;
  onCopied: () => void;
}) {
  const copy = useCallback(async () => {
    if (turn.translated && (await copyText(turn.translated))) {
      haptics.tap();
      onCopied();
    }
  }, [turn.translated, onCopied]);

  return (
    <Animated.View
      entering={animate ? FadeIn.duration(duration.base) : undefined}
      style={styles.turn}
    >
      {showPair ? (
        <Text style={styles.pair}>
          {name(turn.source)} → {name(turn.target)}
        </Text>
      ) : null}
      <View style={styles.heardRow}>
        <Text style={styles.heard}>{turn.heard}</Text>
        {turn.translated ? (
          <IconButton
            icon="speaker"
            size={18}
            color={colors.textFaint}
            label="თარგმანის ხელახლა მოსმენა"
            onPress={() => translator.replay(turn)}
            style={styles.replay}
          />
        ) : null}
      </View>
      <Pressable
        onPress={onCompose}
        onLongPress={copy}
        delayLongPress={380}
        accessibilityLabel={
          turn.pending ? 'ითარგმნება' : turn.translated || 'ვერ ითარგმნა'
        }
        accessibilityHint="ხანგრძლივად დააჭირე დასაკოპირებლად"
        accessibilityActions={[{ name: 'copy', label: 'დაკოპირება' }]}
        onAccessibilityAction={() => void copy()}
      >
        {turn.pending ? (
          <Text style={styles.pending}>ვთარგმნი…</Text>
        ) : turn.failed ? (
          <Text style={styles.failed}>ვერ ითარგმნა</Text>
        ) : (
          <Text style={styles.translated}>{turn.translated}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
});

export function TranslatorView({
  onCompose,
  onCopied,
  bottomPadding,
}: {
  onCompose: () => void;
  onCopied: () => void;
  bottomPadding: number;
}) {
  const reduceMotion = useReducedMotion();
  const turns = useTranslatorSession((s) => s.turns);
  const liveText = useTranslatorSession((s) => s.liveText);
  const direction = useTranslatorStore((s) => s.direction);
  const autoSpeak = useTranslatorStore((s) => s.autoSpeak);
  const [picking, setPicking] = useState<LanguageSide | null>(null);
  const { ref, behind, jumpToLatest, scrollProps } =
    useStickyScroll<FlatList<TranslationTurn>>();
  const mountedAt = useRef(Date.now()).current;

  const renderItem = useCallback(
    ({ item, index }: { item: TranslationTurn; index: number }) => {
      const prev = index > 0 ? turns[index - 1] : null;
      return (
        <Turn
          turn={item}
          showPair={
            !prev || prev.source !== item.source || prev.target !== item.target
          }
          animate={!reduceMotion && Number(item.id.split('_')[1]) > mountedAt}
          onCompose={onCompose}
          onCopied={onCopied}
        />
      );
    },
    [turns, reduceMotion, mountedAt, onCompose, onCopied],
  );

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">
            თარჯიმანი
          </Text>
          <IconButton
            icon={autoSpeak ? 'speaker' : 'speakerOff'}
            label={`თარგმანის ხმამაღლა წაკითხვა: ${autoSpeak ? 'ჩართულია' : 'გამორთულია'}`}
            selected={autoSpeak}
            color={autoSpeak ? colors.textMuted : colors.textFaint}
            onPress={() => translator.setAutoSpeak(!autoSpeak)}
          />
          <IconButton
            icon="close"
            label="თარჯიმნის დახურვა"
            onPress={() => translator.stop()}
          />
        </View>
        <View style={styles.pairRow}>
          <LanguageChip
            lang={direction.from}
            side="from"
            onPress={() => setPicking('from')}
          />
          <IconButton
            icon="swap"
            label="ენების გაცვლა"
            color={colors.text}
            onPress={() => {
              haptics.selection();
              translator.swap();
            }}
          />
          <LanguageChip
            lang={direction.to}
            side="to"
            onPress={() => setPicking('to')}
          />
        </View>
      </View>

      <Pressable style={styles.flex} onPress={onCompose} accessible={false}>
        {turns.length === 0 && !liveText ? (
          <View style={styles.empty}>
            <Text style={styles.emptyLead}>
              ილაპარაკე {languageNameKaAdverb(direction.from)} — ყოველ წინადადებას{' '}
              {languageNameKaAdverb(direction.to)} გადავთარგმნი
              {autoSpeak ? ' და წავიკითხავ' : ''}.
            </Text>
            <Text style={styles.emptyHint}>
              დასასრულებლად თქვი „შეწყვიტე თარგმნა“ ან დააჭირე ×.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={ref}
            data={turns}
            keyExtractor={(t) => t.id}
            renderItem={renderItem}
            ListFooterComponent={
              liveText ? (
                <View style={styles.live}>
                  <LiveLine text={liveText} align="left" />
                </View>
              ) : null
            }
            contentContainerStyle={[
              styles.content,
              { paddingBottom: bottomPadding + spacing.xl },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            {...scrollProps}
          />
        )}
        {behind ? (
          <JumpToLatest onPress={jumpToLatest} bottom={bottomPadding + spacing.md} />
        ) : null}
      </Pressable>

      <LanguageSheet
        side={picking}
        current={picking === 'to' ? direction.to : direction.from}
        onPick={(lang) => {
          if (picking === 'to') translator.setTo(lang);
          else translator.setFrom(lang);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stroke,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // The icon buttons' own padding lines their glyphs up with the gutter.
    marginRight: -spacing.md,
  },
  title: {
    ...typography.label,
    color: colors.textFaint,
    flex: 1,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  // Sized to the language name (never truncated), left-aligned with the swap
  // between them: reads as a sentence, "Georgian ⇄ English".
  chip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: HIT,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
  },
  chipPressed: { backgroundColor: colors.stroke },
  chipText: {
    ...typography.bodyMedium,
    color: colors.text,
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  turn: {
    marginTop: spacing.xl,
  },
  pair: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.sm,
  },
  heardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heard: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
    paddingTop: spacing.xxs,
  },
  replay: {
    marginTop: -spacing.sm,
    marginRight: -spacing.md,
  },
  translated: {
    ...typography.reading,
    color: colors.text,
    marginTop: spacing.xs,
  },
  pending: {
    ...typography.body,
    color: colors.textFaint,
    marginTop: spacing.xs,
  },
  failed: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  live: { marginTop: spacing.xl },
  empty: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  emptyLead: {
    ...typography.reading,
    color: colors.text,
  },
  emptyHint: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.md,
  },
});
