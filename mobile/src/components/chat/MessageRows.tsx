import React, { memo, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { audioLevel } from '@/lib/audioLevel';
import { copyText } from '@/lib/clipboard';
import { haptics } from '@/lib/haptics';
import { colors, easeOut, radius, spacing, typography } from '@/theme';

import { MiaAvatar } from './MiaAvatar';
import { useSmoothReveal } from './useSmoothReveal';

// The pieces of a conversation.
//   Mia      — her marble at the head of the reply, then calm reading text.
//              While she writes, the newest letters arrive warm and settle
//              to white; while she talks, her marble breathes.
//   You      — a tinted capsule on the right, in the brand violet.
//   Thinking — her marble and three notes of her colours, rising in turn.
//   Speaking — your words forming live, beside bars that move with your
//              actual voice level.

const AVATAR = 24;
const AVATAR_GAP = spacing.md;

const COPY_ACTION = [{ name: 'copy', label: 'დაკოპირება' }];

/** New rows rise a few points as they fade in — never bounce. */
export const rowEnter = FadeInDown.duration(260).easing(easeOut).withInitialValues({
  transform: [{ translateY: 10 }],
});

function useCopy(content: string, onCopied: () => void) {
  return useCallback(async () => {
    if (!content) return;
    if (await copyText(content)) {
      haptics.tap();
      onCopied();
    }
  }, [content, onCopied]);
}

// ── Mia ─────────────────────────────────────────────────────────────────

export const MiaRow = memo(function MiaRow({
  content,
  live,
  speaking,
  animate,
  onCopied,
  children,
}: {
  content: string;
  /** Still streaming in: reveal evenly, with fresh ink. */
  live: boolean;
  /** Her voice is playing: the marble breathes. */
  speaking: boolean;
  animate: boolean;
  onCopied: () => void;
  /** Extra content under the text (the translator's replay button). */
  children?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const { text, freshFrom } = useSmoothReveal(content, live && !reduceMotion);
  const copy = useCopy(content, onCopied);
  if (!text) return null;

  return (
    <Animated.View entering={animate ? rowEnter : undefined} style={styles.miaRow}>
      <View style={styles.avatarCol}>
        <MiaAvatar size={AVATAR} live={speaking} />
      </View>
      <Pressable
        style={styles.miaBody}
        onLongPress={copy}
        delayLongPress={380}
        accessibilityLabel={`Mia: ${content}`}
        accessibilityHint="ხანგრძლივად დააჭირე დასაკოპირებლად"
        accessibilityActions={COPY_ACTION}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'copy') void copy();
        }}
      >
        <Text style={styles.miaText}>
          {text.slice(0, freshFrom)}
          {freshFrom < text.length ? (
            <Text style={styles.fresh}>{text.slice(freshFrom)}</Text>
          ) : null}
        </Text>
        {children}
      </Pressable>
    </Animated.View>
  );
});

// ── You ─────────────────────────────────────────────────────────────────

export const UserRow = memo(function UserRow({
  content,
  animate,
  onCopied,
  caption,
}: {
  content: string;
  animate: boolean;
  onCopied: () => void;
  /** Small line above the capsule (the translator's language pair). */
  caption?: string;
}) {
  const copy = useCopy(content, onCopied);
  return (
    <Animated.View entering={animate ? rowEnter : undefined} style={styles.userRow}>
      {caption ? <Text style={styles.userCaption}>{caption}</Text> : null}
      <Pressable
        onLongPress={copy}
        delayLongPress={380}
        accessibilityLabel={`შენ: ${content}`}
        accessibilityHint="ხანგრძლივად დააჭირე დასაკოპირებლად"
        accessibilityActions={COPY_ACTION}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'copy') void copy();
        }}
        style={styles.capsule}
      >
        <Text style={styles.userText}>{content}</Text>
      </Pressable>
    </Animated.View>
  );
});

// ── Thinking ────────────────────────────────────────────────────────────

const NOTE_COLORS = [colors.gradientStart, colors.gradientMid, colors.gradientEnd];

function Note({ index, still }: { index: number; still: boolean }) {
  const v = useSharedValue(still ? 0.5 : 0);
  useEffect(() => {
    if (still) return;
    v.value = withDelay(
      index * 150,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 260 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(v);
  }, [v, index, still]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + v.value * 0.55,
    transform: [{ translateY: -v.value * 4 }, { scale: 0.85 + v.value * 0.25 }],
  }));
  return <Animated.View style={[styles.note, { backgroundColor: NOTE_COLORS[index] }, style]} />;
}

export function ThinkingRow({ label }: { label?: string }) {
  const still = useReducedMotion();
  return (
    <Animated.View
      entering={still ? undefined : rowEnter}
      style={styles.miaRow}
      accessibilityLabel={label ?? 'Mia ფიქრობს'}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.avatarCol}>
        <MiaAvatar size={AVATAR} live />
      </View>
      <View style={styles.notes}>
        {[0, 1, 2].map((i) => (
          <Note key={i} index={i} still={still} />
        ))}
        {label ? <Text style={styles.thinkingLabel}>{label}</Text> : null}
      </View>
    </Animated.View>
  );
}

// ── Speaking (you, live) ────────────────────────────────────────────────

const BAR_WEIGHTS = [0.55, 0.9, 1, 0.75, 0.5];

function Bar({ weight, still }: { weight: number; still: boolean }) {
  const style = useAnimatedStyle(() => {
    // audioLevel is dBFS mapped to 0..1; speech sits around 0.45–0.85.
    const lvl = still ? 0.3 : Math.max(0, Math.min(1, (audioLevel.value - 0.25) / 0.55));
    return { height: 4 + 16 * lvl * weight };
  });
  return <Animated.View style={[styles.bar, style]} />;
}

export function SpeakingRow({ text }: { text: string }) {
  const still = useReducedMotion();
  return (
    <Animated.View
      entering={still ? undefined : rowEnter}
      style={styles.userRow}
      accessibilityLiveRegion="polite"
      accessibilityLabel={text ? `შენ: ${text}` : 'გისმენ'}
    >
      <View style={[styles.capsule, styles.capsuleLive]}>
        <View style={styles.bars}>
          {BAR_WEIGHTS.map((w, i) => (
            <Bar key={i} weight={w} still={still} />
          ))}
        </View>
        <Text style={[styles.userText, !text && styles.placeholder]}>
          {text || 'გისმენ…'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  miaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: AVATAR_GAP,
    marginTop: spacing.lg,
  },
  avatarCol: {
    width: AVATAR,
    // Sits on the first line of the reply text.
    paddingTop: 2,
  },
  miaBody: { flex: 1 },
  miaText: {
    ...typography.reading,
    color: colors.text,
  },
  fresh: { color: colors.primarySoft },

  userRow: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    maxWidth: '84%',
    marginTop: spacing.xl,
  },
  userCaption: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(109,59,245,0.24)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(217,201,255,0.22)',
  },
  capsuleLive: {
    backgroundColor: 'rgba(255,77,139,0.12)',
    borderColor: 'rgba(255,77,139,0.45)',
  },
  userText: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  placeholder: { color: colors.textMuted },

  notes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: AVATAR + 2,
  },
  note: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  thinkingLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});
