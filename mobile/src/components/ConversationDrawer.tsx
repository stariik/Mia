import React, { useEffect } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Line, Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BrandMark } from '@/components/BrandMark';
import { useConversationStore } from '@/stores/conversationStore';
import { brandGradient, colors, fonts, radius, spacing, typography } from '@/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = Math.min(330, Math.round(SCREEN_W * 0.84));

type Props = {
  visible: boolean;
  onClose: () => void;
};

function timeAgoGe(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'ახლა';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} წთ წინ`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} სთ წინ`;
  return `${Math.floor(diff / 86_400_000)} დღ წინ`;
}

export function ConversationDrawer({ visible, onClose }: Props) {
  const conversations = useConversationStore((s) => s.conversations);
  const order = useConversationStore((s) => s.order);
  const activeId = useConversationStore((s) => s.activeId);
  const newConversation = useConversationStore((s) => s.newConversation);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);

  const tx = useSharedValue(-DRAWER_W);
  const overlay = useSharedValue(0);

  useEffect(() => {
    tx.value = withTiming(visible ? 0 : -DRAWER_W, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
    overlay.value = withTiming(visible ? 1 : 0, { duration: 280 });
  }, [visible, tx, overlay]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlay.value * 0.7,
  }));

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.root]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.drawer, { width: DRAWER_W }, drawerStyle]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.flex}>
          <View style={styles.header}>
            <Text style={[typography.title, styles.headerTitle]}>
              საუბრები
            </Text>
            <Pressable
              onPress={() => {
                newConversation();
                onClose();
              }}
              style={styles.newBtn}
              hitSlop={6}
            >
              <Svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke={colors.primary}
                strokeWidth={2.2}
                strokeLinecap="round"
              >
                <Line x1="12" y1="5" x2="12" y2="19" />
                <Line x1="5" y1="12" x2="19" y2="12" />
              </Svg>
              <Text style={styles.newBtnLabel}>ახალი</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          >
            {order.length === 0 ? (
              <View style={styles.emptyState}>
                <BrandMark size={72} />
                <Text style={styles.emptyTitle}>საუბრები ჯერ არ გაქვს</Text>
                <Text style={styles.emptyHint}>
                  დაიწყე ახალი საუბარი ქვევით
                </Text>
                <Pressable
                  onPress={() => {
                    newConversation();
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.emptyCta,
                    pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                  ]}
                >
                  <LinearGradient
                    colors={[...brandGradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text style={styles.emptyCtaText}>+ ახალი საუბარი</Text>
                </Pressable>
              </View>
            ) : (
              order.map((id) => {
                const c = conversations[id];
                if (!c) return null;
                const isActive = id === activeId;
                return (
                  <View
                    key={id}
                    style={[styles.item, isActive && styles.itemActive]}
                  >
                    <Pressable
                      onPress={() => {
                        selectConversation(id);
                        onClose();
                      }}
                      style={styles.flex}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          typography.body,
                          {
                            color: isActive ? colors.primary : colors.text,
                          },
                        ]}
                      >
                        {c.title}
                      </Text>
                      <Text
                        style={[
                          typography.bodySmall,
                          { color: colors.outline, marginTop: 2 },
                        ]}
                      >
                        {timeAgoGe(c.updatedAt)} · {c.messages.length} შეტყობინება
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteConversation(id)}
                      hitSlop={8}
                      style={styles.delBtn}
                    >
                      <Svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={colors.outline}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <Path d="M3 6h18" />
                        <Path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        <Path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                      </Svg>
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={[typography.mono, { color: colors.outline }]}>
              {order.length} საუბარი
            </Text>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    // Above the top bar (zIndex 10 in HomeScreen) so the Mia wordmark and
    // history button never draw over the open drawer.
    zIndex: 100,
  },
  overlay: {
    backgroundColor: '#000',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surfaceSolid,
    borderRightWidth: 1,
    borderColor: colors.strokeBrandSoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.stroke,
  },
  headerTitle: {
    color: colors.text,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.strokeBrand,
    backgroundColor: 'rgba(255,77,139,0.06)',
  },
  newBtnLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.primary,
    letterSpacing: 0.2,
  },
  list: {
    paddingVertical: spacing.sm,
  },
  emptyState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  emptyTitle: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptyHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyCta: {
    width: '100%',
    height: 48,
    borderRadius: radius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 16,
    elevation: 8,
  },
  emptyCtaText: {
    color: '#ffffff',
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.stroke,
  },
  itemActive: {
    backgroundColor: 'rgba(255,77,139,0.06)',
  },
  delBtn: {
    padding: spacing.xs,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
  },
});
