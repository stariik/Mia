import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi } from '@/api/auth';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { MiaWordmark } from '@/components/MiaWordmark';
import { haptics } from '@/lib/haptics';
import { useAuthStore } from '@/stores/authStore';
import { brandGradient, colors, fonts, radius, spacing, typography } from '@/theme';

type Tab = 'login' | 'register';
type FocusKey = 'email' | 'password' | 'confirm' | null;

function EyeIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={2.6} stroke={color} strokeWidth={1.8} />
      {!open ? (
        <Line
          x1={4}
          y1={20}
          x2={20}
          y2={4}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      ) : null}
    </Svg>
  );
}

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [focused, setFocused] = useState<FocusKey>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [trackW, setTrackW] = useState(0);

  // 0 = login, 1 = register. Normalized progress on the UI thread: layout
  // passes (confirm field mounting/unmounting) can't stomp the transform the
  // way they could with RN Animated's native driver.
  const slide = useSharedValue(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const loginStore = useAuthStore((s) => s.login);

  const pwRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const pillW = trackW > 0 ? (trackW - 8) / 2 : 0;

  const pillStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: slide.value * pillW }],
    }),
    [pillW],
  );
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (tab === 'login' || confirm.length > 0);

  function switchTab(next: Tab) {
    if (next === tab || loading) return;
    haptics.selection();
    setError('');
    setConfirm('');
    setShowPw(false);
    slide.value = withSpring(next === 'login' ? 0 : 1, {
      damping: 18,
      stiffness: 220,
    });
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.4, duration: 100, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
    setTab(next);
  }

  function showError(msg: string) {
    setError(msg);
    haptics.warn();
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  async function submit() {
    if (loading) return;
    setError('');
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) {
      showError('ყველა ველის შევსება სავალდებულოა');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      showError('ელ. ფოსტის ფორმატი არასწორია');
      return;
    }
    if (password.length < 6) {
      showError('პაროლი მინიმუმ 6 სიმბოლო');
      return;
    }
    if (tab === 'register' && password !== confirm) {
      showError('პაროლები არ ემთხვევა');
      return;
    }
    setLoading(true);
    try {
      const { token, user } =
        tab === 'login'
          ? await authApi.login(trimEmail, password)
          : await authApi.register(trimEmail, password);
      haptics.success();
      await loginStore(token, user);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'შეცდომა, სცადე კიდევ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <AuroraBackdrop />

      {/* No KeyboardAvoidingView: the manifest's adjustResize already shrinks
          the window for the keyboard; stacking KAV on top caused the
          open→relayout→blur→close loop. ScrollView handles the rest. */}
      <ScrollView
        style={styles.scrollRoot}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ─────────────────────────────────────────── */}
        <View style={styles.hero}>
          <MiaWordmark size={46} />
          <Text style={styles.tagline}>შენი ხმოვანი ასისტენტი</Text>
        </View>

        {/* ── Auth card ─────────────────────────────────────── */}
        <LinearGradient
          colors={[
            'rgba(109,59,245,0.55)',
            'rgba(255,77,139,0.45)',
            'rgba(255,107,61,0.25)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardBorder}
        >
          <View style={styles.card}>
            {/* Tab switcher */}
            <View
              style={styles.track}
              onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
            >
              {pillW > 0 ? (
                <Reanimated.View
                  style={[styles.pill, { width: pillW }, pillStyle]}
                />
              ) : null}
              <Pressable style={styles.tabBtn} onPress={() => switchTab('login')}>
                <Text style={[styles.tabText, tab === 'login' && styles.tabTextOn]}>
                  შესვლა
                </Text>
              </Pressable>
              <Pressable style={styles.tabBtn} onPress={() => switchTab('register')}>
                <Text style={[styles.tabText, tab === 'register' && styles.tabTextOn]}>
                  რეგისტრაცია
                </Text>
              </Pressable>
            </View>

            {/* Fields */}
            <Animated.View style={[styles.fields, { opacity: fadeAnim }]}>
              {/* Email */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>ელ. ფოსტა</Text>
                <View
                  style={[
                    styles.inputBox,
                    focused === 'email' && styles.inputBoxFocused,
                  ]}
                >
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.outline}
                    value={email}
                    onChangeText={setEmail}
                    onFocus={() => setFocused('email')}
                    onBlur={() => setFocused(null)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => pwRef.current?.focus()}
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>პაროლი</Text>
                <View
                  style={[
                    styles.inputBox,
                    styles.inputBoxRow,
                    focused === 'password' && styles.inputBoxFocused,
                  ]}
                >
                  <TextInput
                    ref={pwRef}
                    style={[styles.input, styles.inputFlex]}
                    placeholder="მინ. 6 სიმბოლო"
                    placeholderTextColor={colors.outline}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    secureTextEntry={!showPw}
                    autoComplete={tab === 'login' ? 'password' : 'new-password'}
                    returnKeyType={tab === 'login' ? 'go' : 'next'}
                    blurOnSubmit={tab === 'login'}
                    onSubmitEditing={
                      tab === 'login' ? submit : () => confirmRef.current?.focus()
                    }
                  />
                  <Pressable
                    onPress={() => setShowPw((v) => !v)}
                    hitSlop={10}
                    style={styles.eyeBtn}
                  >
                    <EyeIcon
                      open={showPw}
                      color={showPw ? colors.primary : colors.outline}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Confirm password — register only */}
              {tab === 'register' && (
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>პაროლის დადასტურება</Text>
                  <View
                    style={[
                      styles.inputBox,
                      focused === 'confirm' && styles.inputBoxFocused,
                      confirm.length > 0 &&
                        password === confirm &&
                        styles.inputBoxMatch,
                    ]}
                  >
                    <TextInput
                      ref={confirmRef}
                      style={styles.input}
                      placeholder="გაიმეორე პაროლი"
                      placeholderTextColor={colors.outline}
                      value={confirm}
                      onChangeText={setConfirm}
                      onFocus={() => setFocused('confirm')}
                      onBlur={() => setFocused(null)}
                      secureTextEntry={!showPw}
                      autoComplete="new-password"
                      returnKeyType="go"
                      onSubmitEditing={submit}
                    />
                  </View>
                </View>
              )}
            </Animated.View>

            {/* Error */}
            {error ? (
              <Animated.View
                style={[
                  styles.errorBox,
                  {
                    transform: [
                      {
                        translateX: shakeAnim.interpolate({
                          inputRange: [-1, 1],
                          outputRange: [-8, 8],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.errorText}>{error}</Text>
              </Animated.View>
            ) : null}

            {/* CTA */}
            <Pressable
              onPress={submit}
              disabled={loading}
              style={({ pressed }) => [
                styles.cta,
                !canSubmit && styles.ctaDim,
                pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
              ]}
            >
              <LinearGradient
                colors={[...brandGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.ctaText}>
                  {tab === 'login' ? 'შესვლა' : 'ანგარიშის შექმნა'}
                </Text>
              )}
            </Pressable>

            {/* Switch hint */}
            <Pressable
              onPress={() => switchTab(tab === 'login' ? 'register' : 'login')}
              hitSlop={8}
              style={styles.switchHint}
            >
              <Text style={styles.switchHintText}>
                {tab === 'login' ? 'არ გაქვს ანგარიში? ' : 'უკვე გაქვს ანგარიში? '}
                <Text style={styles.switchHintAccent}>
                  {tab === 'login' ? 'შექმენი' : 'შესვლა'}
                </Text>
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgDeep,
  },
  scrollRoot: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  // ── Hero ──────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
    gap: spacing.xs,
  },
  tagline: {
    ...typography.bodySmall,
    color: colors.textMuted,
    letterSpacing: 0.4,
  },

  // ── Card border (gradient wrapper) ────────────────────────
  cardBorder: {
    borderRadius: radius.xxl + 1,
    padding: 1,
  },
  card: {
    borderRadius: radius.xxl,
    backgroundColor: colors.surfaceSolid,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    overflow: 'hidden',
  },

  // ── Tab switcher ──────────────────────────────────────────
  track: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: radius.full,
    height: 46,
    marginBottom: spacing.xl,
    padding: 4,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElev,
    borderWidth: 1,
    borderColor: colors.strokeBrand,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tabText: {
    ...typography.labelSm,
    color: colors.outline,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  tabTextOn: {
    color: colors.text,
  },

  // ── Fields ────────────────────────────────────────────────
  fields: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.labelSm,
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
    marginLeft: spacing.xs,
  },
  inputBox: {
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(0,0,0,0.3)',
    height: 50,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  inputBoxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputBoxFocused: {
    borderColor: colors.strokeBrand,
    backgroundColor: 'rgba(255,77,139,0.04)',
  },
  inputBoxMatch: {
    borderColor: 'rgba(116,224,160,0.45)',
  },
  input: {
    ...typography.body,
    color: colors.text,
    padding: 0,
  },
  inputFlex: {
    flex: 1,
  },
  eyeBtn: {
    marginLeft: spacing.sm,
  },

  // ── Error ─────────────────────────────────────────────────
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerStroke,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.danger,
    textAlign: 'center',
  },

  // ── CTA ───────────────────────────────────────────────────
  cta: {
    height: 54,
    borderRadius: radius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 18,
    elevation: 10,
  },
  ctaDim: {
    opacity: 0.6,
  },
  ctaText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: '#ffffff',
    letterSpacing: 0.3,
  },

  // ── Switch hint ───────────────────────────────────────────
  switchHint: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  switchHintText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  switchHintAccent: {
    color: colors.primary,
    fontFamily: fonts.bodyBold,
  },
});
