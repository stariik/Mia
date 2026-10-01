import React, { memo, useCallback, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { copyText } from '@/lib/clipboard';
import { haptics } from '@/lib/haptics';
import type { Message } from '@/stores/conversationStore';
import { colors, duration, spacing, typography } from '@/theme';

import { EmptyState } from './EmptyState';
import { JumpToLatest } from './JumpToLatest';
import { LiveLine } from './LiveLine';
import { useSmoothReveal } from './useSmoothReveal';
import { useStickyScroll } from './useStickyScroll';

// The conversation as typography, not bubbles. Mia's replies are plain
// reading text across the full measure; what the user said sits quieter —
// smaller, muted, set to the right — like a transcript of their side. What is
// being said right now appears live at the bottom, and a streamed reply is
// revealed at an even pace rather than in bursts.

type RowProps = {
  message: Message;
  /** Starts a new exchange (a user line after a reply): more air above. */
  opensTurn: boolean;
  live: boolean;
  animate: boolean;
  onCompose: () => void;
  onCopied: () => void;
};

const COPY_ACTION = [{ name: 'copy', label: 'დაკოპირება' }];

const Row = memo(function Row({
  message,
  opensTurn,
  live,
  animate,
  onCompose,
  onCopied,
}: RowProps) {
  const isUser = message.role === 'user';
  const text = useSmoothReveal(message.content, live && !isUser);

  const copy = useCallback(async () => {
    if (!message.content) return;
    if (await copyText(message.content)) {
      haptics.tap();
      onCopied();
    }
  }, [message.content, onCopied]);

  if (!isUser && !text) return null;

  return (
    <Animated.View
      entering={animate ? FadeIn.duration(duration.base) : undefined}
      style={[
        isUser ? styles.userRow : styles.miaRow,
        opensTurn && styles.opensTurn,
      ]}
    >
      <Pressable
        onPress={onCompose}
        onLongPress={copy}
        delayLongPress={380}
        accessibilityLabel={`${isUser ? 'შენ' : 'Mia'}: ${message.content}`}
        accessibilityHint="ხანგრძლივად დააჭირე დასაკოპირებლად"
        accessibilityActions={COPY_ACTION}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'copy') void copy();
        }}
      >
        <Text style={isUser ? styles.userText : styles.miaText}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
});

export function ChatView({
  messages,
  liveTranscript,
  replyLive,
  onCompose,
  onCopied,
  onSuggestion,
  bottomPadding,
}: {
  messages: Message[];
  /** What the user is saying right now ('' when not listening). */
  liveTranscript: string;
  /** The last reply is still streaming in. */
  replyLive: boolean;
  onCompose: () => void;
  onCopied: () => void;
  onSuggestion: (text: string) => void;
  bottomPadding: number;
}) {
  const reduceMotion = useReducedMotion();
  const { ref, behind, jumpToLatest, scrollProps } =
    useStickyScroll<FlatList<Message>>();
  // Only messages that arrive while the view is up fade in; history doesn't.
  const mountedAt = useRef(Date.now()).current;

  const lastIndex = messages.length - 1;
  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => (
      <Row
        message={item}
        opensTurn={index > 0 && item.role === 'user'}
        live={replyLive && index === lastIndex && item.role === 'assistant'}
        animate={!reduceMotion && item.timestamp > mountedAt}
        onCompose={onCompose}
        onCopied={onCopied}
      />
    ),
    [replyLive, lastIndex, reduceMotion, mountedAt, onCompose, onCopied],
  );

  const footer = useMemo(
    () =>
      liveTranscript ? (
        <View style={[styles.userRow, messages.length > 0 && styles.opensTurn]}>
          <LiveLine text={liveTranscript} />
        </View>
      ) : null,
    [liveTranscript, messages.length],
  );

  if (messages.length === 0 && !liveTranscript) {
    return (
      <Pressable
        style={styles.flex}
        onPress={onCompose}
        accessible={false}
      >
        <EmptyState onSuggestion={onSuggestion} bottomPadding={bottomPadding} />
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.flex} onPress={onCompose} accessible={false}>
      <FlatList
        ref={ref}
        data={messages}
        keyExtractor={(m, i) => `${m.timestamp}-${i}`}
        renderItem={renderItem}
        ListFooterComponent={footer}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        initialNumToRender={20}
        windowSize={11}
        {...scrollProps}
      />
      {behind ? (
        <JumpToLatest onPress={jumpToLatest} bottom={bottomPadding + spacing.md} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    // Clears the soft fade where the chat meets the orb.
    paddingTop: spacing.xxl,
  },
  miaRow: {
    marginTop: spacing.md,
  },
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '84%',
    marginTop: spacing.md,
  },
  opensTurn: {
    marginTop: spacing.xxl,
  },
  miaText: {
    ...typography.reading,
    color: colors.text,
  },
  userText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
