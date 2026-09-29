import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useNavigation } from '@react-navigation/native';

import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { WheelPopover, type WheelAnchor } from '@/components/WheelPopover';
import { tickSound } from '@/lib/tickSound';
import { nativePlatform } from '@/lib/tools/platform/native';
import type { RootNav } from '@/navigation/navigationRef';
import { useToolsStore } from '@/stores/toolsStore';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const QUICK_DURATIONS_SEC = [
  { label: '1 წთ', sec: 60 },
  { label: '5 წთ', sec: 300 },
  { label: '10 წთ', sec: 600 },
  { label: '15 წთ', sec: 900 },
  { label: '30 წთ', sec: 1800 },
  { label: '1 სთ', sec: 3600 },
];

function formatRemaining(ms: number) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const pad2 = (n: number) => n.toString().padStart(2, '0');

type Unit = 'h' | 'm' | 's';
type FieldDef = {
  label: string;
  count: number;
  value: number;
  set: (v: number) => void;
};
const UNITS: Unit[] = ['h', 'm', 's'];

function noop() {}

function newTimerId() {
  return `timer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function TimersScreen() {
  const navigation = useNavigation<RootNav>();
  const onBack = () => navigation.goBack();
  const timers = useToolsStore((s) => s.timers);
  const [now, setNow] = useState(() => Date.now());
  const [hh, setHh] = useState(0);
  const [mm, setMm] = useState(5);
  const [ss, setSs] = useState(0);
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<{
    unit: Unit;
    anchor: WheelAnchor;
  } | null>(null);
  const fieldRefs = useRef<Record<Unit, View | null>>({ h: null, m: null, s: null });

  useEffect(() => {
    tickSound.preload();
  }, []);

  const fields: Record<Unit, FieldDef> = {
    h: { label: 'სთ', count: 24, value: hh, set: setHh },
    m: { label: 'წთ', count: 60, value: mm, set: setMm },
    s: { label: 'წმ', count: 60, value: ss, set: setSs },
  };

  const openField = (unit: Unit) => {
    haptics.selection();
    fieldRefs.current[unit]?.measureInWindow((x, y, width, height) =>
      setEditing({ unit, anchor: { x, y, width, height } }),
    );
  };

  useEffect(() => {
    if (timers.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timers.length]);

  const customDurationSec = hh * 3600 + mm * 60 + ss;

  const startTimer = (durationSec: number) => {
    if (durationSec <= 0) return;
    haptics.tap();
    nativePlatform.scheduleTimer({
      id: newTimerId(),
      label: label.trim(),
      durationSeconds: durationSec,
    });
    setLabel('');
  };

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
          <Text style={[typography.title, styles.title]}>ტაიმერი</Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Active timers */}
          {timers.length > 0 ? (
            <View style={styles.activeGroup}>
              <Text style={[typography.labelSm, styles.sectionLabel]}>
                აქტიური
              </Text>
              {timers.map((t) => {
                const remaining = Math.max(0, t.endsAt - now);
                const isUrgent = remaining > 0 && remaining <= 10_000;
                const total = t.startedAt ? t.endsAt - t.startedAt : 0;
                const pct =
                  total > 0
                    ? Math.min(1, Math.max(0, (now - t.startedAt!) / total))
                    : null;
                const accent = isUrgent ? colors.warning : colors.primary;
                const borderColor = isUrgent
                  ? 'rgba(255, 210, 138, 0.45)'
                  : 'rgba(255, 77, 139, 0.22)';
                return (
                  <View
                    key={t.id}
                    style={[styles.activeRow, { borderColor }]}
                  >
                    <View style={styles.activeRowTop}>
                      <View style={styles.flex}>
                        <Text style={[styles.activeTime, { color: accent }]}>
                          {formatRemaining(remaining)}
                        </Text>
                        {t.label ? (
                          <Text
                            style={[typography.bodySmall, styles.activeMeta]}
                          >
                            {t.label}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => nativePlatform.cancelTimer(t.id)}
                        style={styles.stopBtn}
                      >
                        <Text style={styles.stopText}>გაჩერება</Text>
                      </Pressable>
                    </View>
                    <View style={styles.activeTrack}>
                      {pct != null ? (
                        <View
                          style={[
                            styles.activeFill,
                            {
                              width: `${pct * 100}%`,
                              backgroundColor: accent,
                            },
                          ]}
                        />
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Custom duration */}
          <Text style={[typography.labelSm, styles.sectionLabel]}>მორგებული</Text>
          <View style={styles.fieldRow}>
            {UNITS.map((unit, i) => {
              const f = fields[unit];
              const active = editing?.unit === unit;
              return (
                <React.Fragment key={unit}>
                  {i > 0 ? <Text style={styles.fieldColon}>:</Text> : null}
                  <View style={styles.fieldCol}>
                    <Pressable
                      ref={(r) => {
                        fieldRefs.current[unit] = r;
                      }}
                      onPress={() => openField(unit)}
                      style={[styles.field, active && styles.fieldActive]}
                    >
                      <Text style={styles.fieldValue}>{pad2(f.value)}</Text>
                    </Pressable>
                    <Text style={styles.fieldLabel}>{f.label}</Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>

          <Text style={[typography.labelSm, styles.sectionLabel]}>დასახელება</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="არასავალდებულო"
            placeholderTextColor={colors.outline}
            cursorColor={colors.primary}
            selectionColor={colors.primaryGlow}
            style={styles.labelInput}
            maxLength={60}
          />

          {/* Quick durations */}
          <Text style={[typography.labelSm, styles.sectionLabel]}>სწრაფი</Text>
          <View style={styles.quickGrid}>
            {QUICK_DURATIONS_SEC.map((q) => (
              <Pressable
                key={q.sec}
                onPress={() => startTimer(q.sec)}
                style={({ pressed }) => [
                  styles.quickBtn,
                  pressed && styles.quickBtnPressed,
                ]}
              >
                <Text style={styles.quickText}>{q.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => startTimer(customDurationSec)}
            disabled={customDurationSec <= 0}
            style={[
              styles.startBtn,
              customDurationSec <= 0 && styles.startBtnDisabled,
            ]}
          >
            <Text style={styles.startText}>დაწყება</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <WheelPopover
        anchor={editing?.anchor ?? null}
        unit={editing ? fields[editing.unit].label : ''}
        count={editing ? fields[editing.unit].count : 0}
        value={editing ? fields[editing.unit].value : 0}
        onChange={editing ? fields[editing.unit].set : noop}
        onClose={() => setEditing(null)}
      />
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
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  sectionLabel: {
    color: colors.outline,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  activeGroup: {
    gap: spacing.sm,
  },
  activeRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,77,139,0.20)',
  },
  activeRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  activeFill: {
    height: '100%',
    borderRadius: 2,
  },
  activeTime: {
    fontFamily: fonts.numeric,
    fontSize: 32,
    lineHeight: 36,
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  activeMeta: {
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  stopBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: 'rgba(255,180,171,0.40)',
  },
  stopText: {
    fontFamily: fonts.bodyBold,
    color: colors.danger,
    fontSize: 13,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickBtn: {
    flexBasis: '31%',
    flexGrow: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  quickBtnPressed: {
    backgroundColor: colors.surfaceElev,
  },
  quickText: {
    fontFamily: fonts.bodyBold,
    color: colors.text,
    fontSize: 15,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  fieldCol: {
    alignItems: 'center',
  },
  field: {
    width: 84,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  fieldActive: {
    borderColor: colors.strokeBrand,
  },
  fieldValue: {
    fontFamily: fonts.numeric,
    fontSize: 40,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  fieldColon: {
    fontFamily: fonts.numeric,
    fontSize: 36,
    lineHeight: 76,
    color: colors.textMuted,
  },
  fieldLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.outline,
    marginTop: spacing.xs,
  },
  labelInput: {
    height: 48,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: radius.lg,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  startBtn: {
    marginTop: spacing.xl,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  startBtnDisabled: {
    opacity: 0.35,
  },
  startText: {
    fontFamily: fonts.bodyBold,
    color: colors.primaryOn,
    fontSize: 16,
  },
});
