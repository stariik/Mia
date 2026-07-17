import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { useTranslator, type Lang, type Turn } from '@/hooks/useTranslator';
import { useSilenceAutoStop } from '@/hooks/useSilenceAutoStop';
import { languageNameKa } from '@/lib/translateLanguages';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radius, spacing, typography } from '@/theme';

type Props = { onBack: () => void };

const FOREIGN_OPTIONS: { code: 'ru' | 'en'; label: string }[] = [
  { code: 'ru', label: 'რუსული' },
  { code: 'en', label: 'ინგლისური' },
];

function BackIcon() {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M19 12H5" />
      <Path d="M12 19l-7-7 7-7" />
    </Svg>
  );
}

function MicIcon({ color }: { color: string }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="9" y="2" width="6" height="12" rx="3" />
      <Path d="M5 11a7 7 0 0014 0" />
      <Path d="M12 18v3" />
    </Svg>
  );
}

function SpeakerIcon({ color }: { color: string }) {
  return (
    <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M11 5L6 9H2v6h4l5 4V5z" />
      <Path d="M15.5 8.5a5 5 0 010 7" />
    </Svg>
  );
}

function TrashIcon() {
  return (
    <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6h18" />
      <Path d="M8 6V4h8v2" />
      <Path d="M6 6l1 14h10l1-14" />
    </Svg>
  );
}

function TurnRow({ turn, onReplay }: { turn: Turn; onReplay: () => void }) {
  return (
    <View style={styles.turn}>
      <Text style={styles.turnHeardLang}>{languageNameKa(turn.source)}</Text>
      <Text style={styles.turnHeard}>{turn.heard}</Text>
      <View style={styles.turnTransRow}>
        <View style={styles.flex}>
          <Text style={styles.turnTransLang}>{languageNameKa(turn.target)}</Text>
          <Text style={styles.turnTrans}>{turn.translated}</Text>
        </View>
        <Pressable onPress={onReplay} hitSlop={10} style={styles.replayBtn}>
          <SpeakerIcon color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

export function TranslatorScreen({ onBack }: Props) {
  const {
    other,
    setOther,
    turns,
    status,
    activeSource,
    error,
    toggleListen,
    stopAndTranslate,
    replay,
    clear,
  } = useTranslator();

  const scrollRef = useRef<ScrollView>(null);

  // Auto-stop the active recording on silence (one-tap UX).
  useSilenceAutoStop(status === 'listening', stopAndTranslate);

  useEffect(() => {
    if (turns.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [turns.length]);

  const onMic = (source: Lang) => {
    haptics.tap();
    toggleListen(source);
  };

  const renderMic = (source: Lang, label: string) => {
    const listeningHere = status === 'listening' && activeSource === source;
    const disabled = status === 'working' || (status === 'listening' && !listeningHere);
    return (
      <Pressable
        onPress={() => onMic(source)}
        disabled={disabled}
        style={[
          styles.mic,
          listeningHere && styles.micActive,
          disabled && styles.micDisabled,
        ]}
      >
        <MicIcon color={listeningHere ? colors.primaryOn : colors.text} />
        <Text style={[styles.micLabel, listeningHere && styles.micLabelActive]}>
          {listeningHere ? 'მისმენ… (შეჩერება)' : label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <AuroraBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />

        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.iconBtn} hitSlop={8}>
            <BackIcon />
          </Pressable>
          <Text style={[typography.title, styles.title]}>თარჯიმანი</Text>
          <Pressable
            onPress={clear}
            style={styles.iconBtn}
            hitSlop={8}
            disabled={turns.length === 0}
          >
            {turns.length > 0 ? <TrashIcon /> : null}
          </Pressable>
        </View>

        {/* Language pair: Georgian (fixed) ⇄ foreign (toggle) */}
        <View style={styles.pairBar}>
          <View style={styles.kaChip}>
            <Text style={styles.kaChipText}>ქართული</Text>
          </View>
          <Text style={styles.swap}>⇄</Text>
          <View style={styles.segment}>
            {FOREIGN_OPTIONS.map((o) => {
              const on = other === o.code;
              return (
                <Pressable
                  key={o.code}
                  onPress={() => setOther(o.code)}
                  disabled={status !== 'idle'}
                  style={[styles.segBtn, on && styles.segBtnOn]}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Transcript */}
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {turns.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>ისაუბრე და გადაგითარგმნი</Text>
              <Text style={styles.emptyBody}>
                დააჭირე ქვემოთ შენს ენას და ილაპარაკე. შენ ⇄ {languageNameKa(other)}.
              </Text>
            </View>
          ) : (
            turns.map((t) => (
              <TurnRow key={t.id} turn={t} onReplay={() => replay(t)} />
            ))
          )}
        </ScrollView>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {status === 'working' ? (
          <Text style={styles.working}>ვთარგმნი…</Text>
        ) : null}

        {/* Two mic buttons */}
        <View style={styles.micRow}>
          {renderMic('ka', 'ქართული')}
          {renderMic(other, languageNameKa(other) ?? other)}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  kaChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  kaChipText: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 15,
  },
  swap: {
    fontFamily: fonts.numeric,
    fontSize: 18,
    color: colors.textMuted,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.stroke,
    padding: 3,
    gap: 3,
  },
  segBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  segBtnOn: { backgroundColor: colors.primary },
  segText: {
    fontFamily: fonts.bodyBold,
    color: colors.textMuted,
    fontSize: 14,
  },
  segTextOn: { color: colors.primaryOn },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 17,
  },
  emptyBody: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  turn: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.stroke,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  turnHeardLang: {
    fontFamily: fonts.bodyBold,
    color: colors.outline,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  turnHeard: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontSize: 15,
  },
  turnTransRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  turnTransLang: {
    fontFamily: fonts.bodyBold,
    color: colors.primary,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  turnTrans: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 19,
    lineHeight: 26,
  },
  replayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElev,
    marginLeft: spacing.sm,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  working: {
    fontFamily: fonts.bodyBold,
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    paddingBottom: spacing.sm,
  },
  micRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  mic: {
    flex: 1,
    height: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  micActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  micDisabled: { opacity: 0.4 },
  micLabel: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  micLabelActive: { color: colors.primaryOn },
});
