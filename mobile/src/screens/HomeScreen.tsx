import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ChatView } from '@/components/chat/ChatView';
import { Composer } from '@/components/chat/Composer';
import { TranslatorView } from '@/components/chat/TranslatorView';
import { ConversationDrawer } from '@/components/ConversationDrawer';
import { MiaWordmark } from '@/components/MiaWordmark';
import { OrbCaption, type CaptionModel } from '@/components/OrbCaption';
import { OrbMarks } from '@/components/OrbMarks';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { userErrorMessage } from '@/lib/errorMessages';
import { haptics } from '@/lib/haptics';
import { refreshLocation } from '@/lib/location';
import { languageNameKaAdverb } from '@/lib/translateLanguages';
import { takeTranslatorFromBackground } from '@/lib/translator/queue';
import { translator } from '@/lib/translator/session';
import { useSilenceAutoStop } from '@/hooks/useSilenceAutoStop';
import { useVoicePipeline } from '@/hooks/useVoicePipeline';
import { ensureWakeWordOnLaunch, useWakeTrigger } from '@/hooks/useWakeWord';
import type { RootNav } from '@/navigation/navigationRef';
import { MiaOrb, type OrbState } from '@/orb';
import {
  selectActiveMessages,
  useConversationStore,
} from '@/stores/conversationStore';
import { useToolsStore } from '@/stores/toolsStore';
import {
  useTranslatorSession,
  type TranslatorPhase,
} from '@/stores/translatorSessionStore';
import { useTranslatorStore } from '@/stores/translatorStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { HIT, bgAlpha, colors, duration, easeOut, spacing, typography } from '@/theme';

// ── Where the orb sits ───────────────────────────────────────────────────
// The orb keeps the exact size and position it had above the old bottom
// toolbar: centred, with its 72pt status slot, in the top 58% of the space
// between the top bar and that (95pt) toolbar. The toolbar is gone, so the
// conversation simply gets the room below.
const TOP_BAR_H = 64;
const OLD_TOOLBAR_H = 95;
const OLD_SECTION_PAD = 16;
const OLD_STATUS_SLOT = 72;
/** Gap between the orb and its caption line. */
const CAPTION_GAP = 8;
/** Where the conversation begins, below the orb's bottom edge. */
const CONVERSATION_GAP = 40;
/** Height of the typing-mode header (the close button row). */
const CHAT_HEADER_H = 52;
const FADE_H = 32;

function orbState(
  listening: boolean,
  thinking: boolean,
  speaking: boolean,
): 'idle' | 'listening' | 'thinking' | 'speaking' {
  if (listening) return 'listening';
  if (speaking) return 'speaking';
  if (thinking) return 'thinking';
  return 'idle';
}

/**
 * The orb's view of the conversation, which bridges the pipeline's gaps so it
 * never drops to idle mid-conversation: a recording being transcribed (or a
 * streaming transcript finalizing) is already "thinking", and a mic that is
 * still opening is already "listening".
 */
function orbFlow(
  base: OrbState,
  processing: boolean,
  arming: boolean,
  streaming: boolean,
  sttState: string,
): OrbState {
  if (base !== 'idle') return base;
  if (processing || (streaming && sttState === 'finalizing')) return 'thinking';
  if (arming || (streaming && sttState === 'connecting')) return 'listening';
  return 'idle';
}

/** Translator phases in the orb's vocabulary. */
function translatorOrbState(phase: TranslatorPhase): OrbState {
  switch (phase) {
    case 'connecting':
    case 'listening':
      return 'listening';
    case 'working':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    default:
      return 'idle';
  }
}

const TRANSCRIBING = 'Transcribing…';

export function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Unchanged formula: the orb's size depends on the window only.
  const orbSize = Math.round(
    Math.max(220, Math.min(width * 0.88, (height - 170) * 0.58 - 88)),
  );

  // Height of the area under the top bar. The keyboard never resizes it
  // (useAnimatedKeyboard below takes over keyboard insets), so the orb holds.
  const [mainH, setMainH] = useState(0);
  const onMainLayout = useCallback((e: LayoutChangeEvent) => {
    setMainH(e.nativeEvent.layout.height);
  }, []);
  const sectionH = 0.58 * (mainH - OLD_TOOLBAR_H);
  const orbTop =
    OLD_SECTION_PAD +
    (sectionH - OLD_SECTION_PAD - (orbSize + OLD_STATUS_SLOT)) / 2;
  const panelTop = orbTop + orbSize + CONVERSATION_GAP;

  const messages = useConversationStore(selectActiveMessages);
  const {
    isListening,
    isThinking,
    isSpeaking,
    isProcessing,
    isArming,
    currentTranscript,
    error,
    setError,
    streaming,
    sttState,
    listeningSeconds,
    keepListening,
  } = useVoiceStore();
  const trActive = useTranslatorSession((s) => s.active);
  const trPhase = useTranslatorSession((s) => s.phase);
  const trError = useTranslatorSession((s) => s.error);
  const trFrom = useTranslatorStore((s) => s.direction.from);
  const timerCount = useToolsStore((s) => s.timers.length);
  const alarmCount = useToolsStore((s) => s.alarms.length);

  const reduceMotion = useReducedMotion();
  const modeIn = reduceMotion ? undefined : FadeIn.duration(260);
  const modeOut = reduceMotion ? undefined : FadeOut.duration(160);

  const pipeline = useVoicePipeline();
  const navigation = useNavigation<RootNav>();
  const [showDrawer, setShowDrawer] = useState(false);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [copiedAt, setCopiedAt] = useState(0);

  // ── Errors: one quiet notice, auto-dismissed after 6 s ─────────────────
  const shownError = error ?? trError;
  const clearError = useCallback(() => {
    setError(null);
    useTranslatorSession.setState({ error: null });
  }, [setError]);
  useEffect(() => {
    if (!shownError) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [shownError, clearError]);

  useEffect(() => {
    if (!copiedAt) return;
    const t = setTimeout(() => setCopiedAt(0), 1400);
    return () => clearTimeout(t);
  }, [copiedAt]);

  // ── Orb ─────────────────────────────────────────────────────────────────
  const state = orbState(isListening, isThinking, isSpeaking);
  const flow = orbFlow(state, isProcessing, isArming, streaming, sttState);
  const chatLook: OrbState = error && flow === 'idle' ? 'error' : flow;
  const orbLook: OrbState = trActive ? translatorOrbState(trPhase) : chatLook;

  // The orb is a single toggle for the whole hands-free conversation: first tap
  // opens it, the next one closes it — whether Mia is listening, thinking or
  // mid-sentence. Between turns the mic re-arms itself, so the tap is only ever
  // needed to start and to stop. In translator mode it opens/closes the
  // interpreter's mic instead.
  const onOrbPress = () => {
    if (useTranslatorSession.getState().active) {
      translator.toggleListening();
      return;
    }
    if (
      pipeline.isConversationActive() ||
      isListening ||
      isThinking ||
      isSpeaking
    ) {
      // The extra flags cover a turn started by TYPING, which has no session of
      // its own but must still be interruptible from the orb.
      pipeline.stopConversation();
      return;
    }
    pipeline.startListening();
  };

  // Auto-close recording after sustained silence (or grace timeout if user
  // never speaks). VAD reads the same SharedValue the orb uses.
  // Destructured because `pipeline` is a fresh object each render while these
  // are stable — passing the object's identity would restart the VAD interval
  // every render and it would never reach its silence threshold.
  const { stopListeningAndSend, stopConversation } = pipeline;
  const onSilenceStop = useCallback(
    (spoke: boolean) => {
      // Silence for the whole window means the user has nothing more to say —
      // end the conversation quietly instead of sending an empty recording to
      // STT and re-arming the mic forever.
      if (spoke) stopListeningAndSend();
      else stopConversation();
    },
    [stopListeningAndSend, stopConversation],
  );
  useSilenceAutoStop(isListening && !streaming, onSilenceStop);

  // Re-arm the background "Hey Mia" service on launch if the user left it on,
  // then fetch the city for weather. Sequential so two permission prompts never
  // overlap. Launch only — never on AppState 'active' (the permission-dialog
  // focus loop); refreshLocation itself asks once per session and backs off.
  useEffect(() => {
    ensureWakeWordOnLaunch()
      .catch(() => {})
      .then(() => refreshLocation())
      .catch(() => {});
  }, []);

  // "Hey Mia, translate…" said while the app was closed: that session parked
  // the request and brought the app forward — open the translator here.
  useEffect(() => {
    const pickUp = () => {
      const req = takeTranslatorFromBackground();
      if (req) void translator.start(req);
    };
    pickUp();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') pickUp();
    });
    return () => sub.remove();
  }, []);

  // Saying "Mia" starts a turn, exactly like tapping the orb (interrupting
  // playback if Mia is mid-sentence). In translator mode it reopens the
  // interpreter's mic. Reads live state so it never goes stale.
  const onWake = useCallback(() => {
    // The orb is about to listen — let it be seen.
    setTyping(false);
    inputRef.current?.blur();
    const tr = useTranslatorSession.getState();
    if (tr.active) {
      if (tr.phase === 'paused') {
        haptics.tap();
        translator.resume();
      }
      return;
    }
    const { isListening: listening, isSpeaking: speaking } =
      useVoiceStore.getState();
    if (listening) return;
    haptics.tap();
    if (speaking) pipeline.stopSpeaking();
    pipeline.startListening();
  }, [pipeline]);
  useWakeTrigger(onWake);

  // ── Typing mode ─────────────────────────────────────────────────────────
  // Focusing the field (or tapping the conversation) opens the conversation
  // over the whole area below the top bar: the orb fades away cleanly instead
  // of being half-covered by the keyboard-raised chat. "დახურვა" (or Android
  // back) closes the keyboard and brings the orb back, exactly where it was.
  const focusComposer = useCallback(() => inputRef.current?.focus(), []);
  const enterTyping = useCallback(() => setTyping(true), []);
  const exitTyping = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
    setTyping(false);
  }, []);
  useEffect(() => {
    if (!typing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitTyping();
      return true;
    });
    return () => sub.remove();
  }, [typing, exitTyping]);
  const onCopied = useCallback(() => setCopiedAt(Date.now()), []);
  const onSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    // The keyboard stays up for a follow-up; the reply streams in above.
    if (useTranslatorSession.getState().active) {
      void translator.translateTyped(text);
    } else {
      pipeline.sendText(text);
    }
  };

  // ── Keyboard: the conversation rides on top of it ───────────────────────
  const keyboard = useAnimatedKeyboard();
  const bottomInset = Platform.OS === 'ios' ? insets.bottom : 0;
  const open = useSharedValue(0);
  useEffect(() => {
    open.value = withTiming(typing ? 1 : 0, {
      duration: reduceMotion ? 0 : duration.slow,
      easing: easeOut,
    });
  }, [typing, open, reduceMotion]);
  const panelStyle = useAnimatedStyle(() => ({
    top: panelTop * (1 - open.value),
    bottom: Math.max(0, keyboard.height.value - bottomInset),
  }));
  // The orb steps back (fades, never moves) while the conversation is open.
  const stageStyle = useAnimatedStyle(() => ({ opacity: 1 - open.value }));

  // ── Caption under the orb ───────────────────────────────────────────────
  let caption: CaptionModel = { text: null };
  if (trActive) {
    if (trPhase === 'paused') caption = { text: 'შეჩერებულია · შეეხე სფეროს' };
    else if (trPhase === 'connecting') caption = { text: 'ვემზადები…' };
    else if (trPhase === 'listening')
      caption = { text: `გისმენ · ილაპარაკე ${languageNameKaAdverb(trFrom)}`, live: true };
    else if (trPhase === 'working') caption = { text: 'ვთარგმნი…' };
    else if (trPhase === 'speaking')
      caption = { text: 'ვკითხულობ თარგმანს · შეეხე შესაწყვეტად' };
  } else if (streaming && isListening) {
    caption = {
      text: 'გისმენ',
      live: true,
      seconds: listeningSeconds,
      onFinish: stopListeningAndSend,
      onKeepListening: pipeline.keepListening,
      keepingOn: keepListening,
    };
  } else if (flow === 'listening') {
    caption = {
      text: streaming && sttState === 'connecting' ? 'ვუკავშირდები…' : 'გისმენ',
      live: isListening,
    };
  } else if (flow === 'thinking') {
    caption = { text: isThinking ? 'ვფიქრობ…' : 'მუშავდება…' };
  } else if (flow === 'speaking') {
    caption = { text: 'ვლაპარაკობ · შეეხე შესაწყვეტად' };
  }

  const liveTranscript =
    currentTranscript && currentTranscript !== TRANSCRIBING
      ? currentTranscript
      : '';
  const last = messages[messages.length - 1];
  const replyLive =
    (isThinking || isSpeaking) && last?.role === 'assistant';

  const toolsHint = [
    timerCount ? `ტაიმერი: ${timerCount}` : null,
    alarmCount ? `მაღვიძარა: ${alarmCount}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        {/* History · Mia · Settings. Equal side slots keep the wordmark on
            the screen's true centre line, above the orb. */}
        <View style={styles.topBar}>
          <View style={styles.topSide}>
            <IconButton
              icon="history"
              label="საუბრების ისტორია"
              onPress={() => setShowDrawer(true)}
            />
          </View>
          <View style={styles.brand} accessibilityRole="header" accessibilityLabel="Mia">
            <MiaWordmark size={20} />
          </View>
          <View style={[styles.topSide, styles.topSideEnd]}>
            <IconButton
              icon="settings"
              label="პარამეტრები"
              onPress={() => navigation.navigate('Settings')}
            />
          </View>
        </View>

        <View style={styles.flex} onLayout={onMainLayout}>
          {mainH > 0 ? (
            <>
              <Animated.View
                style={[
                  styles.stage,
                  { top: orbTop },
                  // The streaming controls reach below the caption line; keep
                  // them above the conversation while they're shown.
                  caption.onFinish && !typing ? styles.stageOver : null,
                  stageStyle,
                ]}
                pointerEvents={typing ? 'none' : 'box-none'}
                importantForAccessibility={typing ? 'no-hide-descendants' : 'auto'}
                accessibilityElementsHidden={typing}
              >
                <Pressable
                  onPress={onOrbPress}
                  accessibilityRole="button"
                  accessibilityLabel={
                    trActive ? 'თარჯიმნის მიკროფონი' : 'ხმოვანი საუბარი'
                  }
                  accessibilityHint={toolsHint || undefined}
                  style={{
                    width: orbSize,
                    height: orbSize,
                    borderRadius: orbSize / 2,
                  }}
                >
                  {/* The orb owns its press physics (shell dip + ripple). */}
                  <View style={styles.flex}>
                    <MiaOrb
                      size={orbSize}
                      state={orbLook}
                      tint={trActive ? 1 : 0}
                      // Hidden behind the open conversation: skip drawing
                      // (Mia's voice still plays through it).
                      paused={typing}
                    />
                    <OrbMarks size={orbSize} />
                  </View>
                </Pressable>
                <View style={styles.caption}>
                  <OrbCaption model={caption} />
                </View>
              </Animated.View>

              <Animated.View style={[styles.panel, panelStyle]}>
                {typing ? (
                  <Animated.View
                    entering={reduceMotion ? undefined : FadeIn.duration(duration.base)}
                    exiting={reduceMotion ? undefined : FadeOut.duration(duration.fast)}
                    style={styles.chatHeader}
                  >
                    <Pressable
                      onPress={exitTyping}
                      accessibilityRole="button"
                      accessibilityLabel="დახურვა"
                      accessibilityHint="კლავიატურა დაიხურება და სფერო დაბრუნდება"
                      hitSlop={4}
                      style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
                    >
                      <Icon name="chevronDown" size={20} color={colors.text} strokeWidth={1.8} />
                      <Text style={styles.closeText}>დახურვა</Text>
                    </Pressable>
                  </Animated.View>
                ) : null}
                <View style={styles.flex}>
                  {trActive ? (
                    <Animated.View
                      key="translator"
                      entering={modeIn}
                      exiting={modeOut}
                      style={styles.flex}
                    >
                      <TranslatorView
                        onCompose={focusComposer}
                        onCopied={onCopied}
                        bottomPadding={0}
                      />
                    </Animated.View>
                  ) : (
                    <Animated.View
                      key="chat"
                      entering={modeIn}
                      exiting={modeOut}
                      style={styles.flex}
                    >
                      <ChatView
                        messages={messages}
                        liveTranscript={liveTranscript}
                        replyLive={replyLive}
                        onCompose={focusComposer}
                        onCopied={onCopied}
                        onSuggestion={(t) => pipeline.sendText(t)}
                        bottomPadding={0}
                      />
                      {/* Where the conversation meets the orb, lines melt away. */}
                      <LinearGradient
                        colors={[colors.bgDeep, bgAlpha(0)]}
                        style={styles.fade}
                        pointerEvents="none"
                      />
                    </Animated.View>
                  )}

                  {shownError || copiedAt ? (
                    <Animated.View
                      entering={reduceMotion ? undefined : FadeIn.duration(180)}
                      exiting={reduceMotion ? undefined : FadeOut.duration(150)}
                      style={styles.noticeWrap}
                      pointerEvents="box-none"
                    >
                      {shownError ? (
                        <Pressable
                          onPress={clearError}
                          accessibilityRole="alert"
                          accessibilityHint="შეეხე დასახურად"
                          style={styles.notice}
                        >
                          <View style={styles.noticeMark} />
                          <Text style={styles.noticeText}>
                            {userErrorMessage(shownError)}
                          </Text>
                        </Pressable>
                      ) : (
                        <View style={styles.notice} accessibilityLiveRegion="polite">
                          <Text style={styles.noticeText}>დაკოპირდა</Text>
                        </View>
                      )}
                    </Animated.View>
                  ) : null}
                </View>

                <Composer
                  value={draft}
                  onChangeText={setDraft}
                  onSend={onSend}
                  onFocus={enterTyping}
                  inputRef={inputRef}
                  placeholder={
                    trActive
                      ? `დაწერე ${languageNameKaAdverb(trFrom)}…`
                      : 'მიწერე Mia-ს…'
                  }
                />
              </Animated.View>
            </>
          ) : null}
        </View>

        <ConversationDrawer
          visible={showDrawer}
          onClose={() => setShowDrawer(false)}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgDeep,
  },
  flex: { flex: 1 },

  topBar: {
    height: TOP_BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    // Icon glyphs (22 in a 44 target) line up with the 24pt gutter.
    paddingHorizontal: spacing.xl - 11,
    // Wins hit-testing over the orb, which can reach up under the bar on
    // tall phones.
    zIndex: 10,
  },
  topSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topSideEnd: { justifyContent: 'flex-end' },
  brand: {
    alignItems: 'center',
  },

  stage: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stageOver: { zIndex: 3 },
  caption: {
    marginTop: CAPTION_GAP,
    alignSelf: 'stretch',
    backgroundColor: colors.bgDeep,
  },

  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
    backgroundColor: colors.bgDeep,
  },
  chatHeader: {
    height: CHAT_HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    // The chevron's glyph lines up with the 24pt gutter.
    paddingLeft: spacing.xl - 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stroke,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: HIT,
    paddingHorizontal: spacing.sm,
  },
  closeText: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  pressed: { opacity: 0.6 },
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FADE_H,
  },

  noticeWrap: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.lg,
    alignItems: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
  },
  noticeMark: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.danger,
  },
  noticeText: {
    ...typography.caption,
    color: colors.text,
    flexShrink: 1,
  },
});
