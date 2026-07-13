import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import { authApi } from '@/api/auth';
import { useWakeWordToggle } from '@/hooks/useWakeWord';
import { refreshLocation } from '@/lib/location';
import { useAuthStore } from '@/stores/authStore';
import { useLocationStore } from '@/stores/locationStore';
import { useVoiceStore, type TTSProvider } from '@/stores/voiceStore';
import { brandGradient, colors, radius, spacing, typography } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const TTS_OPTIONS: Array<{ value: TTSProvider; label: string; hint: string }> = [
  { value: 'elevenlabs', label: 'ElevenLabs', hint: 'რეკომენდირებული — სწრაფი და ბუნებრივი' },
  { value: 'camb', label: 'Camb.ai', hint: 'ალტერნატივა — შესაძლოა ნელი' },
  { value: 'openai', label: 'OpenAI', hint: 'სათადარიგო — გამოთქმა მიახლოებითია' },
];

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'];

export function SettingsSheet({ visible, onClose }: Props) {
  const { ttsProvider, setTtsProvider, openaiVoice, setOpenaiVoice } =
    useVoiceStore();
  const { user, logout } = useAuthStore();

  const detectedCity = useLocationStore((s) => s.city);
  const manualCity = useLocationStore((s) => s.manualCity);
  const setManualCity = useLocationStore((s) => s.setManualCity);
  const [cityDraft, setCityDraft] = useState(manualCity ?? '');

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

  useEffect(() => {
    if (visible) setCityDraft(manualCity ?? '');
  }, [visible, manualCity]);

  const commitCity = () => {
    const trimmed = cityDraft.trim();
    setManualCity(trimmed || undefined);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={[typography.title, styles.title]}>პარამეტრები</Text>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[typography.labelSm, styles.section]}>
            ხმის სინთეზი
          </Text>
          {TTS_OPTIONS.map((opt) => {
            const active = ttsProvider === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setTtsProvider(opt.value)}
                style={[styles.row, active && styles.rowActive]}
              >
                <View style={styles.flex}>
                  <Text style={[typography.body, styles.rowLabel]}>
                    {opt.label}
                  </Text>
                  <Text style={[typography.bodySmall, styles.rowHint]}>
                    {opt.hint}
                  </Text>
                </View>
                {active ? <View style={styles.dot} /> : null}
              </Pressable>
            );
          })}

          {ttsProvider === 'openai' ? (
            <>
              <Text style={[typography.labelSm, styles.section, styles.sectionTop]}>
                ხმის ტიპი
              </Text>
              <View style={styles.voiceGrid}>
                {OPENAI_VOICES.map((v) => {
                  const active = openaiVoice === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setOpenaiVoice(v)}
                      style={[styles.voiceChip, active && styles.voiceChipActive]}
                    >
                      <Text
                        style={[
                          typography.bodySmall,
                          { color: active ? colors.primary : colors.textMuted },
                        ]}
                      >
                        {v}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

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

        <Pressable
          onPress={onClose}
          style={({ pressed }) => [
            styles.doneBtn,
            pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
          ]}
        >
          <LinearGradient
            colors={[...brandGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.doneText}>დასრულება</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceSolid,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.strokeBrandSoft,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    marginBottom: spacing.md,
  },
  body: {
    paddingBottom: spacing.xl,
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
  rowActive: {
    borderColor: colors.strokeBrand,
    backgroundColor: 'rgba(255,77,139,0.06)',
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
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  voiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  voiceChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.stroke,
    backgroundColor: 'rgba(2,4,16,0.4)',
  },
  voiceChipActive: {
    borderColor: colors.strokeBrand,
    backgroundColor: 'rgba(255,77,139,0.08)',
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
  doneBtn: {
    width: '100%',
    height: 52,
    borderRadius: radius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 16,
    elevation: 8,
  },
  doneText: {
    color: '#ffffff',
    fontFamily: 'Manrope-SemiBold',
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
