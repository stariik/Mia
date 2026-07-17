import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';

import { AlarmEditSheet } from '@/components/AlarmEditSheet';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { nativePlatform } from '@/lib/tools/platform/native';
import { useToolsStore, type ActiveAlarm } from '@/stores/toolsStore';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const DAY_LABELS_GE = ['კვ', 'ორ', 'სმ', 'ოთ', 'ხუ', 'პარ', 'შაბ'];

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function describeDays(days?: number[]) {
  if (!days || days.length === 0) return 'ერთჯერადი';
  if (days.length === 7) return 'ყოველდღე';
  // Mon-Fri
  if (
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => days.includes(d))
  ) {
    return 'სამუშაო დღეები';
  }
  if (days.length === 2 && days.includes(0) && days.includes(6)) {
    return 'შაბათ-კვირა';
  }
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS_GE[d])
    .join(' · ');
}

type Props = {
  onBack: () => void;
};

export function AlarmsScreen({ onBack }: Props) {
  const alarms = useToolsStore((s) => s.alarms);
  const [editing, setEditing] = useState<ActiveAlarm | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const sorted = useMemo(
    () => [...alarms].sort((a, b) => a.ringsAt - b.ringsAt),
    [alarms],
  );

  return (
    <View style={styles.root}>
      <AuroraBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />

        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.iconBtn} hitSlop={8}>
            <Svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={colors.text}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Path d="M19 12H5" />
              <Path d="M12 19l-7-7 7-7" />
            </Svg>
          </Pressable>
          <Text style={[typography.title, styles.title]}>მაღვიძარები</Text>
          <Pressable
            onPress={() => setShowAdd(true)}
            style={[styles.iconBtn, styles.addBtn]}
            hitSlop={8}
          >
            <Svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={colors.primary}
              strokeWidth={2}
              strokeLinecap="round"
            >
              <Line x1="12" y1="5" x2="12" y2="19" />
              <Line x1="5" y1="12" x2="19" y2="12" />
            </Svg>
          </Pressable>
        </View>

        {sorted.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[typography.bodyLg, { color: colors.textMuted }]}>
              მაღვიძარები არ არის
            </Text>
            <Text style={[typography.bodySmall, styles.emptySub]}>
              დაამატე ახალი მაღვიძარა + ღილაკით
            </Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => setEditing(item)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowTime}>{formatTime(item.ringsAt)}</Text>
                  <Text style={[typography.bodySmall, styles.rowMeta]}>
                    {describeDays(item.days)}
                    {item.label ? ` · ${item.label}` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => nativePlatform.cancelAlarm(item.id)}
                  hitSlop={10}
                  style={styles.delBtn}
                >
                  <Svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={colors.danger}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  >
                    <Path d="M3 6h18" />
                    <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </Svg>
                </Pressable>
              </Pressable>
            )}
          />
        )}

        <AlarmEditSheet
          visible={showAdd || !!editing}
          alarm={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  safe: { flex: 1, backgroundColor: 'transparent' },
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
  addBtn: {
    backgroundColor: 'rgba(255,77,139,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,139,0.32)',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptySub: {
    color: colors.outline,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  rowPressed: {
    opacity: 0.85,
    backgroundColor: colors.surfaceElev,
  },
  rowMain: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTime: {
    fontFamily: fonts.numeric,
    fontSize: 36,
    lineHeight: 40,
    color: colors.text,
    letterSpacing: -1,
  },
  rowMeta: {
    color: colors.textMuted,
  },
  delBtn: {
    padding: spacing.sm,
  },
});
