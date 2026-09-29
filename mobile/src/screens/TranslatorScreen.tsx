import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';

import { useNavigation } from '@react-navigation/native';

import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import type { RootNav } from '@/navigation/navigationRef';
import { useTranslator, type Lang, type Turn } from '@/hooks/useTranslator';
import { useSilenceAutoStop } from '@/hooks/useSilenceAutoStop';
import {
  FOREIGN_LANGS,
  languageNameKa,
  languageNameKaAdverb,
  type ForeignLang,
} from '@/lib/translateLanguages';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const COPIED_MS = 1500;

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

function SpeakerIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M11 5L6 9H2v6h4l5 4V5z" />
      <Path d="M15.5 8.5a5 5 0 010 7" />
    </Svg>
  );
}

function SpeakerOffIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M11 5L6 9H2v6h4l5 4V5z" />
      <Path d="M22 9l-6 6" />
      <Path d="M16 9l6 6" />
    </Svg>
  );
}

function CopyIcon({ color }: { color: string }) {
  return (
    <Svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="9" y="9" width="12" height="12" rx="2" />
      <Path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
    </Svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 6L9 17l-5-5" />
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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(turn.translated);
    } catch (e) {
      console.warn('[Translator] copy failed', e);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <View style={styles.turn}>
      <Text style={styles.turnHeardLang}>{languageNameKa(turn.source)}</Text>
      <Text style={styles.turnHeard}>{turn.heard}</Text>
      <View style={styles.turnTransRow}>
        <View style={styles.flex}>
          <Text style={styles.turnTransLang}>{languageNameKa(turn.target)}</Text>
          <Text style={styles.turnTrans} selectable>
            {turn.translated}
          </Text>
        </View>
        <Pressable
          onPress={onCopy}
          hitSlop={10}
          style={styles.replayBtn}
          accessibilityLabel={copied ? 'დაკოპირდა' : 'დაკოპირება'}
        >
          {copied ? (
            <CheckIcon color={colors.success} />
          ) : (
            <CopyIcon color={colors.primary} />
          )}
        </Pressable>
        <Pressable
          onPress={onReplay}
          hitSlop={10}
          style={styles.replayBtn}
          accessibilityLabel="მოსმენა"
        >
          <SpeakerIcon color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

// One side of the direction bar. Georgian is fixed; the foreign side is a
// tappable chip that cycles through the supported foreign languages.
function LangChip({
  caption,
  lang,
  disabled,
  onPickForeign,
}: {
  caption: string;
  lang: Lang;
  disabled: boolean;
  onPickForeign: (lang: ForeignLang) => void;
}) {
  const label = languageNameKa(lang) ?? lang;
  if (lang === 'ka') {
    return (
      <View style={styles.dirSide}>
        <Text style={styles.dirCaption}>{caption}</Text>
        <View style={styles.kaChip}>
          <Text style={styles.kaChipText}>{label}</Text>
        </View>
      </View>
    );
  }
  const next =
    FOREIGN_LANGS[(FOREIGN_LANGS.indexOf(lang) + 1) % FOREIGN_LANGS.length];
  return (
    <View style={styles.dirSide}>
      <Text style={styles.dirCaption}>{caption}</Text>
      <Pressable
        onPress={() => onPickForeign(next)}
        disabled={disabled}
        style={[styles.foreignChip, disabled && styles.dimmed]}
        accessibilityLabel={`${label} — შეცვლა: ${languageNameKa(next)}`}
      >
        <Text style={styles.foreignChipText}>{label}</Text>
        <Text style={styles.foreignChipCaret}>▾</Text>
      </Pressable>
    </View>
  );
}

export function TranslatorScreen() {
  const navigation = useNavigation<RootNav>();
  const onBack = () => navigation.goBack();
  const {
    direction,
    swap,
    setForeign,
    autoSpeak,
    setAutoSpeak,
    turns,
    status,
    error,
    toggleListen,
    stopAndTranslate,
    translateTyped,
    replay,
    clear,
  } = useTranslator();

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const idle = status === 'idle';

  // Auto-stop the active recording on silence (one-tap UX).
  useSilenceAutoStop(status === 'listening', stopAndTranslate);

  useEffect(() => {
    if (turns.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [turns.length]);

  const onMic = () => {
    haptics.tap();
    toggleListen();
  };

  const canSend = idle && draft.trim().length > 0;
  const onSend = async () => {
    if (!canSend) return;
    if (await translateTyped(draft)) {
      setDraft('');
      Keyboard.dismiss();
    }
  };

  const listening = status === 'listening';
  const fromLabel = languageNameKa(direction.from) ?? direction.from;
  const toLabel = languageNameKa(direction.to) ?? direction.to;

  return (
    <View style={styles.root}>
      <AuroraBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />

        <View style={styles.header}>
          <View style={styles.headerSide}>
            <Pressable onPress={onBack} style={styles.iconBtn} hitSlop={8}>
              <BackIcon />
            </Pressable>
          </View>
          <Text style={[typography.title, styles.title]}>თარჯიმანი</Text>
          <View style={[styles.headerSide, styles.headerSideRight]}>
            <Pressable
              onPress={() => setAutoSpeak(!autoSpeak)}
              style={styles.iconBtn}
              hitSlop={8}
              accessibilityLabel={`ხმამაღლა წაკითხვა: ${
                autoSpeak ? 'ჩართულია' : 'გამორთულია'
              }`}
            >
              {autoSpeak ? (
                <SpeakerIcon color={colors.text} size={20} />
              ) : (
                <SpeakerOffIcon color={colors.textMuted} size={20} />
              )}
            </Pressable>
            <Pressable
              onPress={clear}
              style={styles.iconBtn}
              hitSlop={8}
              disabled={turns.length === 0}
            >
              {turns.length > 0 ? <TrashIcon /> : null}
            </Pressable>
          </View>
        </View>

        {/* Direction: From → To, one side always Georgian */}
        <View style={styles.dirBar}>
          <LangChip
            caption="საიდან"
            lang={direction.from}
            disabled={!idle}
            onPickForeign={setForeign}
          />
          <Pressable
            onPress={swap}
            disabled={!idle}
            hitSlop={6}
            style={[styles.swapBtn, !idle && styles.dimmed]}
            accessibilityLabel="მიმართულების შეცვლა"
          >
            <Text style={styles.swap}>⇄</Text>
          </Pressable>
          <LangChip
            caption="სად"
            lang={direction.to}
            disabled={!idle}
            onPickForeign={setForeign}
          />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Transcript */}
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {turns.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  ისაუბრე ან დაწერე — გადაგითარგმნი
                </Text>
                <Text style={styles.emptyBody}>
                  {fromLabel} → {toLabel}
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

          {/* Typed translation */}
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={`დაწერე ${languageNameKaAdverb(direction.from)}…`}
              placeholderTextColor={colors.outline}
              cursorColor={colors.primary}
              selectionColor={colors.primaryGlow}
              multiline
              submitBehavior="blurAndSubmit"
              returnKeyType="send"
              onSubmitEditing={onSend}
              style={styles.input}
            />
            <Pressable
              onPress={onSend}
              disabled={!canSend}
              style={[styles.sendBtn, !canSend && styles.dimmed]}
            >
              <Text style={styles.sendText}>თარგმნა</Text>
            </Pressable>
          </View>

          {/* Mic: records in the "from" language */}
          <View style={styles.micRow}>
            <Pressable
              onPress={onMic}
              disabled={status === 'working'}
              style={[
                styles.mic,
                listening && styles.micActive,
                status === 'working' && styles.micDisabled,
              ]}
            >
              <MicIcon color={listening ? colors.primaryOn : colors.text} />
              <Text style={[styles.micLabel, listening && styles.micLabelActive]}>
                {listening
                  ? 'მისმენ… (შეჩერება)'
                  : `ისაუბრე ${languageNameKaAdverb(direction.from)}`}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
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
  headerSide: {
    width: 88,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSideRight: { justifyContent: 'flex-end' },
  dirBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  dirSide: { flex: 1, gap: spacing.xs },
  dirCaption: {
    fontFamily: fonts.bodyBold,
    color: colors.outline,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  kaChip: {
    height: 42,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kaChipText: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 15,
  },
  foreignChip: {
    height: 42,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foreignChipText: {
    fontFamily: fonts.bodyBold,
    color: colors.primaryOn,
    fontSize: 15,
  },
  foreignChipCaret: {
    fontFamily: fonts.body,
    color: colors.primaryOn,
    fontSize: 12,
  },
  swapBtn: {
    width: 40,
    height: 40,
    marginBottom: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElev,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  swap: {
    fontFamily: fonts.numeric,
    fontSize: 18,
    color: colors.text,
  },
  dimmed: { opacity: 0.4 },
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.lg,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    fontFamily: fonts.body,
    color: colors.text,
    fontSize: 15,
  },
  sendBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontFamily: fonts.bodyBold,
    color: colors.primaryOn,
    fontSize: 14,
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
