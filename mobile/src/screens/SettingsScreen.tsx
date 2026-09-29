import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useNavigation } from '@react-navigation/native';

import { authApi } from '@/api/auth';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { useWakeWordToggle } from '@/hooks/useWakeWord';
import { refreshLocation } from '@/lib/location';
import type { RootNav } from '@/navigation/navigationRef';
import { useAuthStore } from '@/stores/authStore';
import { useLocationStore } from '@/stores/locationStore';
import { useProfileStore } from '@/stores/profileStore';
import { colors, radius, spacing, typography } from '@/theme';

export function SettingsScreen() {
  const navigation = useNavigation<RootNav>();
  const onBack = () => navigation.goBack();
  const { user, logout } = useAuthStore();

  const detectedCity = useLocationStore((s) => s.city);
  const manualCity = useLocationStore((s) => s.manualCity);
  const setManualCity = useLocationStore((s) => s.setManualCity);
  const [cityDraft, setCityDraft] = useState(manualCity ?? '');

  const facts = useProfileStore((s) => s.facts);
  const removeFact = useProfileStore((s) => s.removeFact);
  const clearFacts = useProfileStore((s) => s.clear);

  const wake = useWakeWordToggle();
  const [wakeNote, setWakeNote] = useState<string | null>(null);

  // Account deletion (Play requirement): collapsed danger link → inline
  // password confirm. Deleting logs the user out (back to AuthScreen).
  const [deleteMode, setDeleteMode] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

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
    if (res.ok) {
      setWakeNote(null);
    } else if (res.reason === 'no-mic') {
      setWakeNote('მიკროფონის ნებართვა საჭიროა');
    } else {
      setWakeNote('ჩართვა ვერ მოხერხდა');
    }
  };

  const commitCity = () => {
    const trimmed = cityDraft.trim();
    setManualCity(trimmed || undefined);
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
          <Text style={[typography.title, styles.title]}>პარამეტრები</Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {wake.available ? (
            <>
              <Text
                style={[typography.labelSm, styles.section, styles.sectionTop]}
              >
                ხმოვანი გამოძახება
              </Text>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <View style={styles.flex}>
                  <Text style={[typography.body, styles.rowLabel]}>
                    „Mia“-ს გამოძახება
                  </Text>
                  <Text style={[typography.bodySmall, styles.rowHint]}>
                    თქვი „Mia“ აპის გახსნის გარეშე
                  </Text>
                  {wakeNote ? (
                    <Text style={[typography.bodySmall, styles.wakeNote]}>
                      {wakeNote}
                    </Text>
                  ) : null}
                </View>
                <Switch
                  value={wake.enabled}
                  disabled={wake.busy}
                  onValueChange={onToggleWake}
                  trackColor={{ false: colors.outlineVariant, true: colors.primary }}
                  thumbColor="#ffffff"
                />
              </View>
            </>
          ) : null}

          <Text style={[typography.labelSm, styles.section, styles.sectionTop]}>
            ქალაქი
          </Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextInput
                value={cityDraft}
                onChangeText={setCityDraft}
                onBlur={commitCity}
                onSubmitEditing={commitCity}
                placeholder={detectedCity ?? 'მაგ. თბილისი'}
                placeholderTextColor={colors.textMuted}
                style={[typography.body, styles.cityInput]}
                returnKeyType="done"
              />
              <Text style={[typography.bodySmall, styles.rowHint]}>
                {manualCity
                  ? 'ხელით მითითებული'
                  : detectedCity
                  ? `ავტომატური: ${detectedCity}`
                  : 'მდებარეობა ამინდისთვის'}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                refreshLocation({ force: true }).catch(() => {});
              }}
              style={styles.linkBtn}
              hitSlop={6}
            >
              <Text style={[typography.labelSm, styles.linkBtnText]}>
                განახლება
              </Text>
            </Pressable>
          </View>

          {/* Long-term memory — facts Mia saved via remember_fact */}
          <Text style={[typography.labelSm, styles.section, styles.sectionTop]}>
            რა იცის Mia-მ შენზე
          </Text>
          {facts.length === 0 ? (
            <Text style={[typography.bodySmall, styles.rowHint]}>
              თქვი, მაგ. „დავითი მქვია“ და Mia დაიმახსოვრებს
            </Text>
          ) : (
            <>
              {facts.map((f) => (
                <View key={f.id} style={[styles.row, { marginBottom: spacing.sm }]}>
                  <Text style={[typography.body, styles.rowLabel, styles.flex]}>
                    {f.text}
                  </Text>
                  <Pressable
                    onPress={() => removeFact(f.id)}
                    style={styles.linkBtn}
                    hitSlop={6}
                  >
                    <Text style={[typography.labelSm, styles.linkBtnText]}>
                      წაშლა
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={clearFacts} hitSlop={6}>
                <Text style={[typography.bodySmall, styles.deleteLinkText]}>
                  ყველაფრის დავიწყება
                </Text>
              </Pressable>
            </>
          )}

          {/* Account */}
          <Text style={[typography.labelSm, styles.section, styles.sectionTop]}>
            ანგარიში
          </Text>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
              {user?.email ?? ''}
            </Text>
            <Pressable onPress={logout} style={styles.signOutBtn} hitSlop={6}>
              <Text style={styles.signOutText}>გასვლა</Text>
            </Pressable>
          </View>

          {!deleteMode ? (
            <Pressable
              onPress={() => {
                setDeleteMode(true);
                setDeleteErr(null);
                setDeletePw('');
              }}
              hitSlop={6}
              style={styles.deleteLink}
            >
              <Text style={[typography.bodySmall, styles.deleteLinkText]}>
                ანგარიშის წაშლა
              </Text>
            </Pressable>
          ) : (
            <View style={styles.deleteBox}>
              <Text style={[typography.bodySmall, styles.deleteWarn]}>
                ანგარიშის წაშლა საბოლოოა. დაადასტურეთ პაროლით:
              </Text>
              <TextInput
                value={deletePw}
                onChangeText={setDeletePw}
                placeholder="პაროლი"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                style={[typography.body, styles.deleteInput]}
              />
              {deleteErr ? (
                <Text style={[typography.bodySmall, styles.deleteErr]}>
                  {deleteErr}
                </Text>
              ) : null}
              <View style={styles.deleteActions}>
                <Pressable
                  onPress={() => setDeleteMode(false)}
                  style={styles.linkBtn}
                  hitSlop={6}
                >
                  <Text style={[typography.labelSm, styles.linkBtnText]}>
                    გაუქმება
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onDeleteAccount}
                  disabled={deleteBusy || !deletePw}
                  style={[
                    styles.signOutBtn,
                    (deleteBusy || !deletePw) && { opacity: 0.4 },
                  ]}
                  hitSlop={6}
                >
                  <Text style={styles.signOutText}>
                    {deleteBusy ? 'იშლება…' : 'სამუდამოდ წაშლა'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  section: {
    color: colors.outline,
    marginBottom: spacing.sm,
    textTransform: 'none',
    letterSpacing: 0.2,
    fontSize: 12,
  },
  sectionTop: {
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.stroke,
    backgroundColor: 'rgba(2,4,16,0.4)',
    marginBottom: spacing.sm,
  },
  rowLabel: {
    color: colors.text,
  },
  rowHint: {
    color: colors.textMuted,
    marginTop: 2,
  },
  wakeNote: {
    color: colors.danger,
    marginTop: 4,
  },
  cityInput: {
    color: colors.text,
    paddingVertical: 0,
  },
  linkBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.strokeBrandSoft,
  },
  linkBtnText: {
    color: colors.primary,
    textTransform: 'none',
    letterSpacing: 0.2,
    fontSize: 12,
  },
  signOutBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dangerStroke,
  },
  signOutText: {
    color: colors.danger,
    textTransform: 'none',
    letterSpacing: 0.2,
    fontSize: 12,
  },
  deleteLink: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  deleteLinkText: {
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  deleteBox: {
    borderWidth: 1,
    borderColor: colors.dangerStroke,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  deleteWarn: {
    color: colors.danger,
  },
  deleteInput: {
    color: colors.text,
    borderBottomWidth: 1,
    borderColor: colors.stroke,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  deleteErr: {
    color: colors.danger,
    marginTop: spacing.xs,
  },
  deleteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
