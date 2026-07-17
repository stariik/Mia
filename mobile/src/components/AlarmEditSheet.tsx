import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { nativePlatform } from '@/lib/tools/platform/native';
import { useToolsStore, type ActiveAlarm } from '@/stores/toolsStore';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const DAY_LABELS_GE = ['კვ', 'ორ', 'სმ', 'ოთ', 'ხუ', 'პარ', 'შაბ'];

type Props = {
  visible: boolean;
  alarm: ActiveAlarm | null;
  onClose: () => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function newAlarmId() {
  return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Compute the next ringsAt from hour/minute/days. For one-shot alarms
 * (no days), returns today at hour:minute or tomorrow if it's already past.
 * For recurring alarms, the engine recomputes based on `days` so this base
 * value mainly carries the hour/minute pair through.
 */
function computeRingsAt(hour: number, minute: number, days: number[]): number {
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (days.length === 0 && next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

export function AlarmEditSheet({ visible, alarm, onClose }: Props) {
  const editing = !!alarm;
  const updateAlarm = useToolsStore((s) => s.updateAlarm);

  const [hour, setHour] = useState('07');
  const [minute, setMinute] = useState('00');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>([]);

  useEffect(() => {
    if (!visible) return;
    if (alarm) {
      const d = new Date(alarm.ringsAt);
      setHour(d.getHours().toString().padStart(2, '0'));
      setMinute(d.getMinutes().toString().padStart(2, '0'));
      setLabel(alarm.label || '');
      setDays(alarm.days ?? []);
    } else {
      setHour('07');
      setMinute('00');
      setLabel('');
      setDays([]);
    }
  }, [visible, alarm]);

  const canSave = useMemo(() => {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    return (
      Number.isFinite(h) &&
      Number.isFinite(m) &&
      h >= 0 &&
      h <= 23 &&
      m >= 0 &&
      m <= 59
    );
  }, [hour, minute]);

  const toggleDay = (d: number) => {
    setDays((prev) =>
      prev.includes(d)
        ? prev.filter((x) => x !== d)
        : [...prev, d].sort((a, b) => a - b),
    );
  };

  const onSave = async () => {
    if (!canSave) return;
    const h = clamp(parseInt(hour, 10), 0, 23);
    const m = clamp(parseInt(minute, 10), 0, 59);
    const ringsAt = computeRingsAt(h, m, days);

    if (editing && alarm) {
      // Edit flow: cancel the old triggers and re-schedule with the new params.
      await nativePlatform.cancelAlarm(alarm.id);
      await nativePlatform.scheduleAlarm({
        id: alarm.id,
        label: label.trim(),
        ringsAt,
        days: days.length > 0 ? days : undefined,
      });
    } else {
      await nativePlatform.scheduleAlarm({
        id: newAlarmId(),
        label: label.trim(),
        ringsAt,
        days: days.length > 0 ? days : undefined,
      });
    }
    onClose();
  };

  const onDelete = async () => {
    if (!alarm) return;
    await nativePlatform.cancelAlarm(alarm.id);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropPress} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={[typography.title, styles.title]}>
            {editing ? 'მაღვიძარის რედაქტირება' : 'ახალი მაღვიძარა'}
          </Text>

          {/* Time */}
          <View style={styles.timeRow}>
            <TextInput
              value={hour}
              onChangeText={(t) => setHour(t.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.timeInput}
              placeholder="HH"
              placeholderTextColor={colors.outline}
              selectionColor={colors.primaryGlow}
              cursorColor={colors.primary}
            />
            <Text style={styles.timeColon}>:</Text>
            <TextInput
              value={minute}
              onChangeText={(t) =>
                setMinute(t.replace(/[^0-9]/g, '').slice(0, 2))
              }
              keyboardType="number-pad"
              maxLength={2}
              style={styles.timeInput}
              placeholder="MM"
              placeholderTextColor={colors.outline}
              selectionColor={colors.primaryGlow}
              cursorColor={colors.primary}
            />
          </View>

          {/* Days */}
          <Text style={[typography.labelSm, styles.sectionLabel]}>
            განმეორება
          </Text>
          <View style={styles.daysRow}>
            {DAY_LABELS_GE.map((lbl, idx) => {
              const active = days.includes(idx);
              return (
                <Pressable
                  key={idx}
                  onPress={() => toggleDay(idx)}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                >
                  <Text
                    style={[
                      styles.dayChipText,
                      active && styles.dayChipTextActive,
                    ]}
                  >
                    {lbl}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.presetRow}>
            <Pressable
              onPress={() => setDays([])}
              style={styles.presetChip}
            >
              <Text style={styles.presetText}>ერთჯერადი</Text>
            </Pressable>
            <Pressable
              onPress={() => setDays([1, 2, 3, 4, 5])}
              style={styles.presetChip}
            >
              <Text style={styles.presetText}>სამუშაო</Text>
            </Pressable>
            <Pressable
              onPress={() => setDays([0, 1, 2, 3, 4, 5, 6])}
              style={styles.presetChip}
            >
              <Text style={styles.presetText}>ყოველდღე</Text>
            </Pressable>
          </View>

          {/* Label */}
          <Text style={[typography.labelSm, styles.sectionLabel]}>დასახელება</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="მაგ. სამსახური"
            placeholderTextColor={colors.outline}
            selectionColor={colors.primaryGlow}
            cursorColor={colors.primary}
            style={styles.labelInput}
            maxLength={60}
          />

          {/* Actions */}
          <View style={styles.actions}>
            {editing ? (
              <Pressable onPress={onDelete} style={styles.deleteBtn}>
                <Text style={styles.deleteText}>წაშლა</Text>
              </Pressable>
            ) : (
              <View style={styles.flex} />
            )}
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>გაუქმება</Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={!canSave}
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            >
              <Text style={styles.saveText}>შენახვა</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdropPress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.strokeBrandSoft,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    marginBottom: spacing.lg,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  timeInput: {
    width: 96,
    height: 96,
    fontFamily: fonts.numeric,
    fontSize: 64,
    lineHeight: 72,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  timeColon: {
    fontFamily: fonts.numeric,
    fontSize: 56,
    color: colors.textMuted,
  },
  sectionLabel: {
    color: colors.outline,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  dayChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  dayChipActive: {
    backgroundColor: 'rgba(255,77,139,0.14)',
    borderColor: colors.primary,
  },
  dayChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
  },
  dayChipTextActive: {
    color: colors.primary,
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  presetChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  presetText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  flex: { flex: 1 },
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: 'rgba(255,180,171,0.40)',
  },
  deleteText: {
    fontFamily: fonts.bodyBold,
    color: colors.danger,
  },
  cancelBtn: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
  },
  saveBtn: {
    height: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
    elevation: 6,
  },
  saveBtnDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveText: {
    color: colors.primaryOn,
    fontFamily: fonts.bodyBold,
  },
});
