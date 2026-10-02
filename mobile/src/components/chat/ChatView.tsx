import React, { useCallback, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { Message } from '@/stores/conversationStore';
import { spacing } from '@/theme';

import { EmptyState } from './EmptyState';
import { JumpToLatest } from './JumpToLatest';
import { MiaRow, SpeakingRow, ThinkingRow, UserRow } from './MessageRows';
import { useStickyScroll } from './useStickyScroll';
import { useTapToCompose } from './useTapToCompose';

// The conversation. Mia speaks in calm reading text under her marble; you
// speak in violet capsules on the right. Whatever is happening right now
// lives at the bottom: your words forming as you talk, or her colours rising
// while she thinks. Scrolling up to reread is never interrupted (see
// useStickyScroll); tapping the conversation focuses the text field.

export function ChatView({
  messages,
  liveTranscript,
  listening,
  awaitingReply,
  replyLive,
  speaking,
  onCompose,
  onCopied,
  onSuggestion,
  bottomPadding,
}: {
  messages: Message[];
  /** What the user is saying right now. */
  liveTranscript: string;
  /** The mic is open for the user. */
  listening: boolean;
  /** Mia is working on a reply and hasn't written any of it yet. */
  awaitingReply: boolean;
  /** The last reply is still streaming in. */
  replyLive: boolean;
  /** Mia's voice is playing. */
  speaking: boolean;
  onCompose: () => void;
  onCopied: () => void;
  onSuggestion: (text: string) => void;
  bottomPadding: number;
}) {
  const reduceMotion = useReducedMotion();
  const { touchProps, claim, noteScroll } = useTapToCompose(onCompose);
  const { ref, behind, jumpToLatest, scrollProps } =
    useStickyScroll<FlatList<Message>>(noteScroll);
  // Only messages that arrive while the view is up animate in; history doesn't.
  const mountedAt = useRef(Date.now()).current;

  const lastIndex = messages.length - 1;
  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const animate = !reduceMotion && item.timestamp > mountedAt;
      if (item.role === 'user') {
        return <UserRow content={item.content} animate={animate} onCopied={onCopied} />;
      }
      const last = index === lastIndex;
      return (
        <MiaRow
          content={item.content}
          live={replyLive && last}
          speaking={speaking && last}
          animate={animate}
          onCopied={onCopied}
        />
      );
    },
    [replyLive, speaking, lastIndex, reduceMotion, mountedAt, onCopied],
  );

  const footer = useMemo(() => {
    if (listening) return <SpeakingRow text={liveTranscript} />;
    if (awaitingReply) return <ThinkingRow />;
    return null;
  }, [listening, liveTranscript, awaitingReply]);

  if (messages.length === 0 && !listening && !awaitingReply) {
    return (
      <EmptyState
        onSuggestion={onSuggestion}
        bottomPadding={bottomPadding}
        touchProps={touchProps}
        onControlPressIn={claim}
      />
    );
  }

  return (
    <View style={styles.flex}>
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
        {...touchProps}
      />
      {behind ? (
        <JumpToLatest onPress={jumpToLatest} bottom={bottomPadding + spacing.md} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    // Clears the soft fade where the chat meets the orb.
    paddingTop: spacing.xl,
  },
});
