import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import Svg, { Line, Path, Polygon, Rect } from 'react-native-svg';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ActiveOrbRings } from '@/components/ActiveOrbRings';
import { ConversationDrawer } from '@/components/ConversationDrawer';
import { SettingsSheet } from '@/components/SettingsSheet';
import { AIAssistantOrb } from '@/components/AIAssistantOrb';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { BottomToolBar } from '@/components/BottomToolBar';
import { MiaWordmark } from '@/components/MiaWordmark';
import { OrbStatus } from '@/components/OrbStatus';
import { SuggestionChips } from '@/components/SuggestionChips';
import { audioLevel as audioLevelSV } from '@/lib/audioLevel';
import { userErrorMessage } from '@/lib/errorMessages';
import { haptics } from '@/lib/haptics';
import { useSilenceAutoStop } from '@/hooks/useSilenceAutoStop';
import { useVoicePipeline } from '@/hooks/useVoicePipeline';
import { ensureWakeWordOnLaunch, useWakeTrigger } from '@/hooks/useWakeWord';
import type { RootNav } from '@/navigation/navigationRef';
import {
  selectActiveMessages,
  useConversationStore,
  type Message,
} from '@/stores/conversationStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { brandGradient, colors, fonts, radius, spacing, typography } from '@/theme';


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

function RecentMessages({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<ScrollView>(null);

  if (messages.length === 0) return null;
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.messages}
      contentContainerStyle={styles.messagesContent}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
    >
      {messages.map((m, i) => {
        const key = `${m.timestamp}-${i}`;
        if (m.role === 'user') {
          return (
            <Animated.View
              key={key}
              entering={FadeIn.duration(260)}
              style={styles.userWrap}
            >
              <View style={styles.userBubble}>
                <Text style={styles.userText}>{m.content}</Text>
              </View>
            </Animated.View>
          );
        }
        return (
          <Animated.View
            key={key}
            entering={FadeIn.duration(260)}
            style={styles.aiWrap}
          >
            <View style={styles.aiBubble}>
              <Text style={styles.aiText}>{m.content}</Text>
            </View>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

export function HomeScreen() {
  const { width, height } = useWindowDimensions();
  // The orb's Pressable is a square; cap it by the orb section's height share
  // (~0.58 of the space between top bar and toolbar, minus the status slot)
  // so it can never extend up under the top bar and swallow taps meant for
  // the history button.
  const orbSize = Math.round(
    Math.max(220, Math.min(width * 0.88, (height - 170) * 0.58 - 88)),
  );

  const messages = useConversationStore(selectActiveMessages);
  const {
    isListening,
    isThinking,
    isSpeaking,
    currentTranscript,
    error,
    setError,
  } = useVoiceStore();

  const pipeline = useVoicePipeline();
  const navigation = useNavigation<RootNav>();
  const [showSettings, setShowSettings] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [input, setInput] = useState('');

  // Auto-dismiss after 6s. The toast is also tappable to dismiss immediately.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error, setError]);

  const state = orbState(isListening, isThinking, isSpeaking);

  // Springy press feedback on the orb itself.
  const orbScale = useSharedValue(1);
  const orbPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: orbScale.value }],
  }));

  // The orb is a single toggle for the whole hands-free conversation: first tap
  // opens it, the next one closes it — whether Mia is listening, thinking or
  // mid-sentence. Between turns the mic re-arms itself, so the tap is only ever
  // needed to start and to stop.
  const onMic = () => {
    haptics.tap();
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
  useSilenceAutoStop(isListening, onSilenceStop);

  // Re-arm the background "Hey Mia" service on launch if the user left it on.
  useEffect(() => {
    ensureWakeWordOnLaunch();
  }, []);

  // Saying "Mia" starts a turn, exactly like tapping the orb (interrupting
  // playback if Mia is mid-sentence). Reads live state so it never goes stale.
  const onWake = useCallback(() => {
    const { isListening: listening, isSpeaking: speaking } =
      useVoiceStore.getState();
    if (listening) return;
    haptics.tap();
    if (speaking) pipeline.stopSpeaking();
    pipeline.startListening();
  }, [pipeline]);
  useWakeTrigger(onWake);

  const onSend = () => {
    const text = input.trim();
    if (!text) return;
    haptics.tap();
    setInput('');
    pipeline.sendText(text);
    setShowInput(false);
  };

  return (
    <View style={styles.root}>
      <AuroraBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />

        {/* Top bar: History (left) · brand (center) · type toggle (right) */}
        <View style={styles.topBar}>
          <View style={styles.topSide}>
            <Pressable
              onPress={() => {
                haptics.tap();
                setShowDrawer(true);
              }}
              style={styles.historyBtn}
              hitSlop={8}
              accessibilityLabel="ისტორია"
            >
              <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M3 3v5h5" />
                <Path d="M3.05 13A9 9 0 106 5.3L3 8" />
                <Path d="M12 7v5l4 2" />
              </Svg>
              <Text style={styles.historyLabel}>ისტორია</Text>
              {messages.length > 0 ? <View style={styles.historyDot} /> : null}
            </Pressable>
          </View>

          <MiaWordmark size={22} />

          <View style={[styles.topSide, styles.topSideRight]}>
            <Pressable
              onPress={() => {
                haptics.tap();
                setShowInput((v) => !v);
              }}
              style={styles.topIconBtn}
              hitSlop={8}
              accessibilityLabel="აკრეფა"
            >
              <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={showInput ? colors.primary : colors.textMuted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <Rect x="2" y="6" width="20" height="12" rx="2" />
                <Line x1="6" y1="10" x2="6" y2="10" />
                <Line x1="10" y1="10" x2="10" y2="10" />
                <Line x1="14" y1="10" x2="14" y2="10" />
                <Line x1="7" y1="14" x2="17" y2="14" />
              </Svg>
            </Pressable>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.orbSection}>
            <Pressable
              onPress={onMic}
              onPressIn={() => {
                orbScale.value = withSpring(0.965, { damping: 16, stiffness: 320 });
              }}
              onPressOut={() => {
                orbScale.value = withSpring(1, { damping: 12, stiffness: 220 });
              }}
              accessibilityRole="button"
              accessibilityLabel="ხმოვანი ჩაწერა"
              style={{ width: orbSize, height: orbSize, borderRadius: orbSize / 2 }}
            >
              <Animated.View style={[styles.flex1, orbPressStyle]}>
                <AIAssistantOrb size={orbSize} state={state} audioLevel={audioLevelSV} />
                <ActiveOrbRings size={orbSize} />
              </Animated.View>
            </Pressable>
            <OrbStatus state={state} transcript={currentTranscript} />
          </View>

          <View style={styles.bottomSection}>
            {messages.length === 0 ? (
              <SuggestionChips onPick={(t) => pipeline.sendText(t)} />
            ) : (
              <View style={styles.messagesMask}>
                <RecentMessages messages={messages} />
                <LinearGradient
                  colors={['rgba(2,2,10,0)', colors.bgDeep]}
                  style={styles.fadeBottom}
                  pointerEvents="none"
                />
              </View>
            )}
          </View>

          {showInput ? (
            <View style={styles.inputBar}>
              <Pressable
                onPress={() => setShowInput(false)}
                style={styles.kbdBtn}
                hitSlop={8}
                accessibilityLabel="ხმაზე დაბრუნება"
              >
                <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <Path d="M19 11v1a7 7 0 0 1-14 0v-1" />
                  <Line x1="12" y1="19" x2="12" y2="23" />
                  <Line x1="8" y1="23" x2="16" y2="23" />
                </Svg>
              </Pressable>

              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="შეტყობინება…"
                placeholderTextColor={colors.outline}
                cursorColor={colors.primary}
                selectionColor={colors.primaryGlow}
                editable={!isThinking && !isSpeaking}
                onSubmitEditing={onSend}
                returnKeyType="send"
                autoFocus
                style={styles.input}
              />

              <Pressable
                onPress={onSend}
                disabled={!input.trim() || isThinking || isSpeaking}
                style={[
                  styles.sendBtn,
                  (!input.trim() || isThinking || isSpeaking) && styles.sendDisabled,
                ]}
              >
                <LinearGradient
                  colors={[...brandGradient]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Line x1="22" y1="2" x2="11" y2="13" />
                  <Polygon points="22 2 15 22 11 13 2 9 22 2" />
                </Svg>
              </Pressable>
            </View>
          ) : (
            <BottomToolBar
              onTranslate={() => navigation.navigate('Translator')}
              onTimer={() => navigation.navigate('Timers')}
              onAlarm={() => navigation.navigate('Alarms')}
              onSettings={() => setShowSettings(true)}
            />
          )}
        </KeyboardAvoidingView>

        {error ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.toast}>
            <Pressable
              onPress={() => setError(null)}
              style={styles.toastInner}
              hitSlop={4}
              accessibilityLabel="დახურვა"
            >
              <Text style={styles.toastText}>{userErrorMessage(error)}</Text>
              <Text style={styles.toastDismiss}>×</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <SettingsSheet
          visible={showSettings}
          onClose={() => setShowSettings(false)}
        />

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
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  flex1: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    // Wins hit-testing over the (later-rendered) orb section, so the orb can
    // never intercept taps on the history / type buttons.
    zIndex: 10,
  },
  topSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topSideRight: {
    justifyContent: 'flex-end',
  },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  historyLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
  },
  historyDot: {
    position: 'absolute',
    top: 5,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  topIconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  orbSection: {
    flex: 0.58,
    alignSelf: 'center',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.lg,
  },
  bottomSection: {
    flex: 0.42,
    paddingHorizontal: spacing.xl,
  },

  messagesMask: {
    flex: 1,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
    zIndex: 2,
  },
  messages: {
    width: '100%',
    flex: 1,
  },
  messagesContent: {
    paddingTop: 14,
    paddingBottom: 14,
  },
  userWrap: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    marginVertical: 5,
  },
  aiWrap: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
    marginVertical: 5,
  },
  userBubble: {
    backgroundColor: 'rgba(255,77,139,0.10)',
    borderWidth: 1,
    borderColor: colors.strokeBrand,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  userText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
  },
  aiBubble: {
    backgroundColor: 'rgba(109,59,245,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(109,59,245,0.32)',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  aiText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  input: {
    flex: 1,
    height: 48,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(20,22,40,0.7)',
    borderWidth: 1,
    borderColor: colors.strokeBrandSoft,
    borderRadius: 24,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.35,
  },
  kbdBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: 120,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(30,18,24,0.95)',
    borderWidth: 1,
    borderColor: colors.dangerStroke,
    overflow: 'hidden',
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  toastText: {
    ...typography.body,
    fontSize: 14,
    color: colors.danger,
    flex: 1,
  },
  toastDismiss: {
    ...typography.body,
    fontSize: 20,
    color: colors.danger,
    paddingHorizontal: spacing.sm,
    marginVertical: -spacing.xs,
  },
});
