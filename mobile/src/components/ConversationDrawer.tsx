import React, { useEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { useConversationStore } from '@/stores/conversationStore';
import { HIT, colors, duration, easeOut, spacing, typography } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function timeAgoGe(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'ახლახან';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} წთ წინ`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} სთ წინ`;
  return `${Math.floor(diff / 86_400_000)} დღის წინ`;
}

/** Past conversations, sliding in from the left over a dimmed screen. */
export function ConversationDrawer({ visible, onClose }: Props) {
  const { width } = useWindowDimensions();
  const drawerW = Math.min(340, Math.round(width * 0.86));
  const reduceMotion = useReducedMotion();
  const conversations = useConversationStore((s) => s.conversations);
  const order = useConversationStore((s) => s.order);
  const activeId = useConversationStore((s) => s.activeId);
  const newConversation = useConversationStore((s) => s.newConversation);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);

  const open = useSharedValue(0);
  useEffect(() => {
    open.value = withTiming(visible ? 1 : 0, {
      duration: reduceMotion ? 0 : duration.slow,
      easing: easeOut,
    });
  }, [visible, open, reduceMotion]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (open.value - 1) * drawerW }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: open.value }));

  const startNew = () => {
    newConversation();
    onClose();
  };

  const visibleIds = order.filter((id) => conversations[id]);

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.root]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="ისტორიის დახურვა"
        />
      </Animated.View>

      <Animated.View
        style={[styles.drawer, { width: drawerW }, drawerStyle]}
        accessibilityViewIsModal
      >
        <SafeAreaView edges={['top', 'bottom']} style={styles.flex}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              საუბრები
            </Text>
            <Pressable
              onPress={startNew}
              accessibilityRole="button"
              accessibilityLabel="ახალი საუბარი"
              style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}
            >
              <Icon name="plus" size={18} color={colors.primary} strokeWidth={1.8} />
              <Text style={styles.newLabel}>ახალი</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {visibleIds.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>ჯერ ცარიელია</Text>
                <Text style={styles.emptyHint}>
                  ყოველი საუბარი აქ შეინახება — დაუბრუნდი ნებისმიერ დროს.
                </Text>
              </View>
            ) : (
              visibleIds.map((id) => {
                const c = conversations[id]!;
                const isActive = id === activeId;
                return (
                  <View key={id} style={styles.item}>
                    {isActive ? <View style={styles.activeMark} /> : null}
                    <Pressable
                      onPress={() => {
                        selectConversation(id);
                        onClose();
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      style={({ pressed }) => [styles.itemMain, pressed && styles.pressed]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.itemTitle, isActive && styles.itemTitleOn]}
                      >
                        {c.title === 'New chat' ? 'ახალი საუბარი' : c.title}
                      </Text>
                      <Text style={styles.itemMeta}>
                        {timeAgoGe(c.updatedAt)} · {c.messages.length} შეტყობინება
                      </Text>
                    </Pressable>
                    <IconButton
                      icon="trash"
                      size={18}
                      color={colors.textFaint}
                      label={`წაშლა: ${c.title}`}
                      onPress={() => deleteConversation(id)}
                    />
                  </View>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    // Above the top bar (zIndex 10 in HomeScreen).
    zIndex: 100,
  },
  scrim: {
    backgroundColor: colors.scrim,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.sheet,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    paddingRight: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: HIT,
    paddingHorizontal: spacing.sm,
  },
  newLabel: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
  pressed: { opacity: 0.6 },
  list: {
    paddingBottom: spacing.xl,
  },
  empty: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  emptyTitle: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  emptyHint: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
  },
  activeMark: {
    position: 'absolute',
    left: 0,
    top: spacing.md,
    bottom: spacing.md,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  itemMain: {
    flex: 1,
    paddingVertical: spacing.md,
  },
  itemTitle: {
    ...typography.body,
    color: colors.text,
  },
  itemTitleOn: {
    fontFamily: typography.bodyMedium.fontFamily,
  },
  itemMeta: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.xxs,
  },
});
