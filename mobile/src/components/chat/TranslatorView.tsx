import React, { memo, useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
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
import { HIT, colors, radius, spacing, typography } from '@/theme';

import { JumpToLatest } from './JumpToLatest';
import { LanguageSheet, type LanguageSide } from './LanguageSheet';
import { MiaRow, SpeakingRow, ThinkingRow, UserRow } from './MessageRows';
import { useStickyScroll } from './useStickyScroll';
import { useTapToCompose } from './useTapToCompose';

// Translator mode takes over the chat area in the chat's own design: the
// language pair on top (from → to, with a swap), then each exchange as what
// was said (capsule, right) and its translation (Mia, left). Close (×)
// returns to the chat; so does saying "stop translating".

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

// One exchange: what was said, as a capsule on the right (like your side of
// a chat), and its translation from Mia — so translator mode
// reads as the same conversation, just in two languages.
const Turn = memo(function Turn({
  turn,
  showPair,
  animate,
  onControlPressIn,
  onCopied,
}: {
  turn: TranslationTurn;
  showPair: boolean;
  animate: boolean;
  onControlPressIn: () => void;
  onCopied: () => void;
}) {
  return (
    <View>
      <UserRow
        content={turn.heard}
        caption={showPair ? `${name(turn.source)} → ${name(turn.target)}` : undefined}
        animate={animate}
        onCopied={onCopied}
      />
      {turn.pending ? (
        <ThinkingRow label="ვთარგმნი…" />
      ) : turn.failed ? (
        <Text style={styles.failed}>ვერ ითარგმნა</Text>
      ) : (
        <MiaRow
          content={turn.translated}
          live={false}
          animate={animate}
          onCopied={onCopied}
        >
          <IconButton
            icon="speaker"
            size={18}
            color={colors.textFaint}
            label="თარგმანის ხელახლა მოსმენა"
            onPressIn={onControlPressIn}
            onPress={() => translator.replay(turn)}
            style={styles.replay}
          />
        </MiaRow>
      )}
    </View>
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
  const { touchProps, claim, noteScroll } = useTapToCompose(onCompose);
  const { ref, behind, jumpToLatest, scrollProps } =
    useStickyScroll<FlatList<TranslationTurn>>(noteScroll);
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
          onControlPressIn={claim}
          onCopied={onCopied}
        />
      );
    },
    [turns, reduceMotion, mountedAt, claim, onCopied],
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

      <View style={styles.flex}>
        {turns.length === 0 && !liveText ? (
          <View style={[styles.flex, styles.empty]} {...touchProps}>
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
              liveText ? <SpeakingRow text={liveText} /> : null
            }
            contentContainerStyle={[
              styles.content,
              { paddingBottom: bottomPadding + spacing.xl },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            {...scrollProps}
            {...touchProps}
          />
        )}
        {behind ? (
          <JumpToLatest onPress={jumpToLatest} bottom={bottomPadding + spacing.md} />
        ) : null}
      </View>

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
  replay: {
    alignSelf: 'flex-start',
    marginLeft: -spacing.md,
    marginTop: -spacing.xs,
  },
  failed: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
    marginLeft: 24 + spacing.md,
  },
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
