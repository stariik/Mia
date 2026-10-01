import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { useNavigation } from '@react-navigation/native';

import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import type { RootNav } from '@/navigation/navigationRef';
import { useTranslator, type Lang, type Turn } from '@/hooks/useTranslator';
import { useSilenceAutoStop } from '@/hooks/useSilenceAutoStop';
import {
  TRANSLATOR_LANGS,
  languageNameKa,
  languageNameKaAdverb,
} from '@/lib/translateLanguages';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const COPIED_MS = 1500;
const MIC_HEIGHT = 72;
// Mic row = button + its top padding; the hide animation collapses this.
const MIC_ROW_HEIGHT = MIC_HEIGHT + spacing.sm;
const MIC_ANIM_MS = 300;
// How far the mic drifts down as it fades out.
const MIC_SETTLE_PX = 8;

// Loaded lazily: the navigator imports this screen eagerly, so a build that
// predates expo-clipboard's native module would otherwise crash at launch
// instead of just failing to copy.
async function copyToClipboard(text: string) {
  const Clipboard: typeof import('expo-clipboard') = require('expo-clipboard');
  await Clipboard.setStringAsync(text);
}

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
      await copyToClipboard(turn.translated);
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

// One side of the direction bar: a chip that opens the language picker.
function LangChip({
  caption,
  lang,
  disabled,
  onOpenPicker,
}: {
  caption: string;
  lang: Lang;
  disabled: boolean;
  onOpenPicker: () => void;
}) {
  const label = languageNameKa(lang) ?? lang;
  return (
    <View style={styles.dirSide}>
      <Text style={styles.dirCaption}>{caption}</Text>
      <Pressable
        onPress={onOpenPicker}
        disabled={disabled}
        style={[styles.langChip, disabled && styles.dimmed]}
        accessibilityLabel={`${caption}: ${label} — ენის შეცვლა`}
      >
        <Text style={styles.langChipText} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.langChipCaret}>▾</Text>
      </Pressable>
    </View>
  );
}

type PickerSide = 'from' | 'to';

const PICKER_TITLE: Record<PickerSide, string> = {
  from: 'რომელი ენიდან?',
  to: 'რომელ ენაზე?',
};

// Bottom sheet listing the Translator languages, Georgian first. The "to"
// list leaves out the "from" language — translating into it makes no sense.
function LanguagePicker({
  side,
  current,
  exclude,
  onPick,
  onClose,
}: {
  side: PickerSide | null;
  current: Lang;
  exclude?: Lang;
  onPick: (lang: Lang) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={side !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={[typography.title, styles.sheetTitle]}>
          {side ? PICKER_TITLE[side] : ''}
        </Text>
        {TRANSLATOR_LANGS.filter((code) => code !== exclude).map((code) => {
          const on = code === current;
          return (
            <Pressable
              key={code}
              onPress={() => onPick(code)}
              style={[styles.langRow, on && styles.langRowOn]}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.langRowText, on && styles.langRowTextOn]}>
                {languageNameKa(code)}
              </Text>
              {on ? <CheckIcon color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

export function TranslatorScreen() {
  const navigation = useNavigation<RootNav>();
  const onBack = () => navigation.goBack();
  const {
    direction,
    swap,
    setFrom,
    setTo,
    autoSpeak,
    setAutoSpeak,
    turns,
    status,
    liveText,
    error,
    toggleListen,
    stopAndTranslate,
    translateTyped,
    replay,
    clear,
  } = useTranslator();

  const [draft, setDraft] = useState('');
  const [pickerSide, setPickerSide] = useState<PickerSide | null>(null);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const idle = status === 'idle';
  const live = status === 'live';
  // Mic is "on" for a legacy recording or a live interpreter session.
  const listening = status === 'listening' || live;

  // Hidden while typing, but never mid-recording — the user must still be
  // able to stop it. Two phases on one progress value (1 shown → 0 hidden):
  // the mic fades out at full size first, and only once it's invisible does
  // its row collapse, so nothing visible is ever squashed or clipped. Showing
  // runs the same curve backwards: the space opens, then the mic fades in.
  const micShown = !(typing && !listening);
  const micAnim = useSharedValue(1);
  useEffect(() => {
    micAnim.value = withTiming(micShown ? 1 : 0, {
      duration: MIC_ANIM_MS,
      // Symmetric, so the fade and the collapse each get half the duration.
      easing: Easing.inOut(Easing.quad),
    });
  }, [micShown, micAnim]);
  const micAnimStyle = useAnimatedStyle(() => ({
    height: interpolate(micAnim.value, [0, 0.5], [0, MIC_ROW_HEIGHT], 'clamp'),
    opacity: interpolate(micAnim.value, [0.5, 1], [0, 1], 'clamp'),
    transform: [
      {
        translateY: interpolate(
          micAnim.value,
          [0.5, 1],
          [MIC_SETTLE_PX, 0],
          'clamp',
        ),
      },
    ],
  }));

  // Auto-stop the active recording on silence (one-tap UX).
  useSilenceAutoStop(status === 'listening', stopAndTranslate);

  // Android's back button closes the keyboard but leaves the input focused,
  // which would keep the mic hidden — blur it whenever the keyboard goes away.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      inputRef.current?.blur();
    });
    return () => sub.remove();
  }, []);

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
            {/* Trash only once there is something to clear, so the speaker
                toggle always sits at the far right. */}
            {turns.length > 0 ? (
              <Pressable onPress={clear} style={styles.iconBtn} hitSlop={8}>
                <TrashIcon />
              </Pressable>
            ) : null}
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
          </View>
        </View>

        {/* Direction: From → To */}
        <View style={styles.dirBar}>
          <LangChip
            caption="საიდან"
            lang={direction.from}
            disabled={!idle}
            onOpenPicker={() => setPickerSide('from')}
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
            onOpenPicker={() => setPickerSide('to')}
          />
        </View>

        <LanguagePicker
          side={pickerSide}
          current={pickerSide === 'to' ? direction.to : direction.from}
          exclude={pickerSide === 'to' ? direction.from : undefined}
          onPick={(lang) => {
            if (pickerSide === 'to') setTo(lang);
            else setFrom(lang);
            setPickerSide(null);
          }}
          onClose={() => setPickerSide(null)}
        />

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

          {/* Live: the sentence being spoken right now */}
          {live ? (
            <Text style={styles.live}>{liveText}▌</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {status === 'working' ? (
            <Text style={styles.working}>ვთარგმნი…</Text>
          ) : null}

          {/* Mic: records in the "from" language */}
          <Animated.View
            style={[styles.micClip, micAnimStyle]}
            pointerEvents={micShown ? 'auto' : 'none'}
            importantForAccessibility={micShown ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!micShown}
          >
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
                <MicIcon color={listening ? colors.primary : colors.text} />
                <Text style={[styles.micLabel, listening && styles.micLabelActive]}>
                  {live
                    ? 'პირდაპირი თარგმანი… (შეჩერება)'
                    : listening
                    ? 'მისმენ… (შეჩერება)'
                    : `ისაუბრე ${languageNameKaAdverb(direction.from)}`}
                </Text>
              </Pressable>
            </View>
          </Animated.View>

          {/* Typed translation */}
          <View style={styles.composer}>
            <TextInput
              ref={inputRef}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
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
  // Nudged toward the screen edge; a transform so the centred title stays put.
  headerSideRight: {
    justifyContent: 'flex-end',
    transform: [{ translateX: spacing.md }],
  },
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
  langChip: {
    height: 42,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langChipText: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 15,
  },
  langChipCaret: {
    fontFamily: fonts.body,
    color: colors.textMuted,
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.strokeBrandSoft,
    gap: spacing.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    color: colors.text,
    marginBottom: spacing.sm,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
  },
  langRowOn: { backgroundColor: colors.surfaceElev },
  langRowText: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 16,
  },
  langRowTextOn: { color: colors.primary },
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
  live: {
    fontFamily: fonts.body,
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
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
    paddingBottom: spacing.md,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  micClip: { overflow: 'hidden' },
  micRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  mic: {
    flex: 1,
    height: MIC_HEIGHT,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  micActive: {
    backgroundColor: colors.surfaceElev,
    borderColor: colors.primary,
  },
  micDisabled: { opacity: 0.4 },
  micLabel: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  micLabelActive: { color: colors.text },
});
