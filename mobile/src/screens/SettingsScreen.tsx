import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { authApi } from '@/api/auth';
import { IconButton } from '@/components/ui/IconButton';
import { useWakeWordToggle } from '@/hooks/useWakeWord';
import { refreshLocation } from '@/lib/location';
import { translator } from '@/lib/translator/session';
import type { RootNav } from '@/navigation/navigationRef';
import { useAuthStore } from '@/stores/authStore';
import { useLocationStore } from '@/stores/locationStore';
import { useProfileStore } from '@/stores/profileStore';
import { useTranslatorStore } from '@/stores/translatorStore';
import { HIT, colors, spacing, typography } from '@/theme';

// Settings as a quiet, grouped list: a large title, sentence-case group
// labels, rows divided by hairlines — no cards, no boxes. Destructive
// actions sit last and stay text-only until confirmed.

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel} accessibilityRole="header">
        {label}
      </Text>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

function Row({
  title,
  hint,
  note,
  children,
  last,
}: {
  title: string;
  hint?: string;
  note?: string | null;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowRule]}>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function TextButton({
  label,
  onPress,
  tone = 'accent',
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'danger' | 'muted';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.textBtn,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.textBtnLabel, styles[tone]]}>{label}</Text>
    </Pressable>
  );
}

const switchColors = {
  trackColor: { false: colors.outlineVariant, true: colors.primary },
  thumbColor: '#ffffff',
};

export function SettingsScreen() {
  const navigation = useNavigation<RootNav>();
  const { user, logout } = useAuthStore();

  const detectedCity = useLocationStore((s) => s.city);
  const manualCity = useLocationStore((s) => s.manualCity);
  const setManualCity = useLocationStore((s) => s.setManualCity);
  const [cityDraft, setCityDraft] = useState(manualCity ?? '');

  const facts = useProfileStore((s) => s.facts);
  const removeFact = useProfileStore((s) => s.removeFact);
  const clearFacts = useProfileStore((s) => s.clear);

  const autoSpeak = useTranslatorStore((s) => s.autoSpeak);

  const wake = useWakeWordToggle();
  const [wakeNote, setWakeNote] = useState<string | null>(null);

  // Account deletion (Play requirement): a text link → inline password
  // confirm. Deleting logs the user out (back to AuthScreen).
  const [deleteMode, setDeleteMode] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // The keyboard height counts from the screen edge; on iOS the safe area
  // already holds the home-indicator strip, so don't pad it twice.
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'ios' ? insets.bottom : 0;
  const keyboard = useAnimatedKeyboard();
  const keyboardPad = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - bottomInset),
  }));

  const onDeleteAccount = async () => {
    if (deleteBusy || !user?.email || !deletePw) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await authApi.deleteAccount(user.email, deletePw);
      await logout();
    } catch (err) {
      setDeleteErr(
        err instanceof Error && err.message === 'Incorrect email or password'
          ? 'პაროლი არასწორია'
          : 'წაშლა ვერ მოხერხდა — სცადეთ მოგვიანებით',
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const onToggleWake = async (next: boolean) => {
    const res = await wake.set(next);
    if (res.ok) setWakeNote(null);
    else if (res.reason === 'no-mic') setWakeNote('მიკროფონის ნებართვა საჭიროა');
    else setWakeNote('ჩართვა ვერ მოხერხდა');
  };

  const commitCity = () => {
    setManualCity(cityDraft.trim() || undefined);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.nav}>
          <IconButton
            icon="chevronLeft"
            label="უკან"
            color={colors.text}
            onPress={() => navigation.goBack()}
          />
        </View>

        <Animated.View style={[styles.flex, keyboardPad]}>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title} accessibilityRole="header">
              პარამეტრები
            </Text>

            <Group label="ხმა">
              {wake.available ? (
                <Row
                  title="„Mia“-ს გამოძახება"
                  hint="თქვი „Mia“ — აპის გახსნის გარეშეც"
                  note={wakeNote}
                >
                  <Switch
                    value={wake.enabled}
                    disabled={wake.busy}
                    onValueChange={onToggleWake}
                    accessibilityLabel="„Mia“-ს გამოძახება"
                    {...switchColors}
                  />
                </Row>
              ) : null}
              <Row
                title="თარგმანის ხმამაღლა წაკითხვა"
                hint="თარჯიმანი ყოველ თარგმანს წაიკითხავს"
                last
              >
                <Switch
                  value={autoSpeak}
                  onValueChange={(on) => translator.setAutoSpeak(on)}
                  accessibilityLabel="თარგმანის ხმამაღლა წაკითხვა"
                  {...switchColors}
                />
              </Row>
            </Group>

            <Group label="მდებარეობა">
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>ქალაქი</Text>
                  <TextInput
                    value={cityDraft}
                    onChangeText={setCityDraft}
                    onBlur={commitCity}
                    onSubmitEditing={commitCity}
                    placeholder={detectedCity ?? 'მაგ. თბილისი'}
                    placeholderTextColor={colors.textFaint}
                    cursorColor={colors.primary}
                    selectionColor={colors.primaryGlow}
                    returnKeyType="done"
                    accessibilityLabel="ქალაქი"
                    style={styles.input}
                  />
                  <Text style={styles.rowHint}>
                    {manualCity
                      ? 'ხელით მითითებული — ამინდისთვის'
                      : detectedCity
                      ? `ავტომატურად: ${detectedCity}`
                      : 'ამინდისთვის; ცარიელი — ავტომატურად'}
                  </Text>
                </View>
                <TextButton
                  label="განახლება"
                  onPress={() => {
                    refreshLocation({ force: true }).catch(() => {});
                  }}
                />
              </View>
            </Group>

            <Group label="რა იცის Mia-მ შენზე">
              {facts.length === 0 ? (
                <Text style={styles.empty}>
                  თქვი, მაგალითად, „დავითი მქვია“ — Mia დაიმახსოვრებს.
                </Text>
              ) : (
                <>
                  {facts.map((f, i) => (
                    <View
                      key={f.id}
                      style={[styles.row, i < facts.length - 1 && styles.rowRule]}
                    >
                      <Text style={[styles.fact, styles.flex]}>{f.text}</Text>
                      <IconButton
                        icon="close"
                        size={18}
                        color={colors.textFaint}
                        label={`დავიწყება: ${f.text}`}
                        onPress={() => removeFact(f.id)}
                      />
                    </View>
                  ))}
                  <TextButton label="ყველაფრის დავიწყება" tone="muted" onPress={clearFacts} />
                </>
              )}
            </Group>

            <Group label="ანგარიში">
              <Row title={user?.email ?? ''} last>
                <TextButton label="გასვლა" onPress={logout} />
              </Row>
              {!deleteMode ? (
                <TextButton
                  label="ანგარიშის წაშლა"
                  tone="danger"
                  onPress={() => {
                    setDeleteMode(true);
                    setDeleteErr(null);
                    setDeletePw('');
                  }}
                />
              ) : (
                <View style={styles.confirm}>
                  <Text style={styles.confirmText}>
                    ანგარიშის წაშლა საბოლოოა. დასადასტურებლად შეიყვანე პაროლი.
                  </Text>
                  <TextInput
                    value={deletePw}
                    onChangeText={setDeletePw}
                    placeholder="პაროლი"
                    placeholderTextColor={colors.textFaint}
                    cursorColor={colors.primary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoFocus
                    accessibilityLabel="პაროლი"
                    style={[styles.input, styles.inputBoxed]}
                  />
                  {deleteErr ? <Text style={styles.rowNote}>{deleteErr}</Text> : null}
                  <View style={styles.confirmActions}>
                    <TextButton
                      label="გაუქმება"
                      tone="muted"
                      onPress={() => setDeleteMode(false)}
                    />
                    <TextButton
                      label={deleteBusy ? 'იშლება…' : 'სამუდამოდ წაშლა'}
                      tone="danger"
                      disabled={deleteBusy || !deletePw}
                      onPress={onDeleteAccount}
                    />
                  </View>
                </View>
              )}
            </Group>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  flex: { flex: 1 },
  nav: {
    height: 64,
    justifyContent: 'center',
    // The chevron's glyph lines up with the 24pt gutter.
    paddingLeft: spacing.xl - 14,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  title: {
    ...typography.display,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  group: { marginTop: spacing.xxl },
  groupLabel: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.xs,
  },
  groupBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.stroke,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.md,
  },
  rowRule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stroke,
  },
  rowTitle: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  rowHint: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.xxs,
  },
  rowNote: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.body,
    color: colors.text,
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
    minHeight: HIT - 8,
  },
  inputBoxed: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.strokeStrong,
    marginTop: spacing.sm,
  },
  fact: {
    ...typography.body,
    color: colors.text,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    paddingVertical: spacing.md,
  },
  textBtn: {
    minHeight: HIT,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  textBtnLabel: {
    ...typography.bodyMedium,
  },
  accent: { color: colors.primary },
  danger: { color: colors.danger },
  muted: { color: colors.textMuted },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  confirm: {
    paddingVertical: spacing.md,
  },
  confirmText: {
    ...typography.body,
    color: colors.textMuted,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
});
