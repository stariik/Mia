import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi } from '@/api/auth';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';
import { AuthField } from '@/components/auth/AuthField';
import { GradientButton } from '@/components/auth/GradientButton';
import { ArrowIcon, SparkIcon } from '@/components/auth/icons';
import { IslandOrb } from '@/components/auth/IslandOrb';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { SuccessBurst } from '@/components/auth/SuccessBurst';
import { MiaWordmark } from '@/components/MiaWordmark';
import { userErrorMessage } from '@/lib/errorMessages';
import { haptics } from '@/lib/haptics';
import { type AuthUser, useAuthStore } from '@/stores/authStore';
import { colors, fonts, radius, spacing, typography } from '@/theme';

// Auth flow: Sign in ↔ Create account (email step → password step) → a short
// success moment before RootNavigator swaps to Home. Every mode change slides
// the card content in the direction of travel while the card itself springs
// to its new height, so the flow reads as one continuous surface.

type Mode = 'login' | 'email' | 'password' | 'done';
type DoneKind = 'login' | 'register' | 'guest';

const ORDER: Record<Mode, number> = { login: 0, email: 1, password: 2, done: 3 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUCCESS_HOLD_MS = 1300;
// Tight, near-critically damped spring: settles in ~250ms with no wobble.
const SNAPPY = { damping: 24, stiffness: 340, mass: 0.8 };
// Launch entrance: a short, eased rise with no overshoot, as the splash
// crossfades out.
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const ENTER_MS = 650;

const COPY: Record<Exclude<Mode, 'done'>, { title: string; subtitle: string; cta: string }> = {
  login: {
    title: 'კეთილი იყოს შენი დაბრუნება',
    subtitle: 'შედი ანგარიშზე და განაგრძე საუბარი Mia-სთან',
    cta: 'შესვლა',
  },
  email: {
    title: 'შევქმნათ შენი ანგარიში',
    subtitle: 'დავიწყოთ ელ. ფოსტით — სულ რამდენიმე წამი',
    cta: 'გაგრძელება',
  },
  password: {
    title: 'მოიფიქრე პაროლი',
    subtitle: '',
    cta: 'ანგარიშის შექმნა',
  },
};

const DONE_COPY: Record<DoneKind, { title: string; subtitle: string }> = {
  login: { title: 'მოგესალმები!', subtitle: 'Mia უკვე გელოდება…' },
  register: { title: 'ანგარიში შეიქმნა!', subtitle: 'კეთილი იყოს შენი მობრძანება Mia-ში' },
  guest: { title: 'სტუმრის რეჟიმი', subtitle: 'დეველოპერის სესია ჩაირთო' },
};

function authErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/incorrect email or password/i.test(msg)) return 'ელ. ფოსტა ან პაროლი არასწორია';
  if (/already in use/i.test(msg)) return 'ეს ელ. ფოსტა უკვე დარეგისტრირებულია';
  if (/invalid email/i.test(msg)) return 'ელ. ფოსტის ფორმატი არასწორია';
  if (/not found/i.test(msg)) return 'სტუმრის რეჟიმი მხოლოდ დეველოპმენტშია ხელმისაწვდომი';
  return userErrorMessage(msg);
}

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const loginStore = useAuthStore((s) => s.login);

  const [mode, setMode] = useState<Mode>('login');
  const [doneKind, setDoneKind] = useState<DoneKind>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<'submit' | 'guest' | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // Bottom padding that lifts the page above the keyboard (0 while hidden).
  const [kbInset, setKbInset] = useState(0);
  const [trackW, setTrackW] = useState(0);

  const emailRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Timers call go() from older renders; read the live mode.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const dirRef = useRef(1);
  const focusNext = useRef<React.RefObject<TextInput | null> | null>(null);
  const mounted = useRef(false);
  const rootRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const kbHeight = useRef(0);
  const kbInsetRef = useRef(0);
  // Root height with the keyboard down, and its latest height.
  const restH = useRef(0);
  const rootH = useRef(0);

  const contentX = useSharedValue(0);
  const contentO = useSharedValue(1);
  const tabPos = useSharedValue(0);
  const step = useSharedValue(0);
  const shake = useSharedValue(0);
  const pulse = useSharedValue(1);

  const isRegister = mode === 'email' || mode === 'password';
  const trimmedEmail = email.trim().toLowerCase();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  const pwLongEnough = password.length >= 6;
  const pwMatch = confirm.length > 0 && confirm === password;

  const ready =
    mode === 'login'
      ? emailValid && password.length > 0
      : mode === 'email'
        ? emailValid
        : pwLongEnough && pwMatch;

  function later(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  // The keyboard draws over the window: iOS never resizes it, and Android
  // (edge-to-edge is forced at targetSdk 36) ignores adjustResize. Pad the
  // page by whatever part of the keyboard the window didn't shrink away, so
  // this stays right even on a device where adjustResize still works.
  function updateInset() {
    const shrunk = Math.max(0, restH.current - rootH.current);
    const next = Math.max(0, Math.round(kbHeight.current - shrunk));
    kbInsetRef.current = next;
    setKbInset(next);
  }

  // Scroll the focused field (plus a little room for the button below it)
  // into the area above the keyboard.
  function revealFocused() {
    const input = TextInput.State.currentlyFocusedInput();
    const root = rootRef.current;
    if (!input || !root || kbHeight.current === 0) return;
    root.measureInWindow((_rx, ry, _rw, rh) => {
      input.measureInWindow((_ix, iy, _iw, ih) => {
        const top = ry + insets.top + spacing.md;
        const bottom = ry + rh - kbInsetRef.current - spacing.lg;
        const below = iy + ih + spacing.xl - bottom;
        const above = top - iy;
        const delta = below > 0 ? below : above > 0 ? -above : 0;
        if (delta !== 0) {
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + delta), animated: true });
        }
      });
    });
  }

  useEffect(() => {
    const t = timers.current;
    // iOS fires will* events, so the page moves with the keyboard.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e: KeyboardEvent) => {
      kbHeight.current = e.endCoordinates.height;
      updateInset();
      setKeyboardOpen(true);
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      kbHeight.current = 0;
      updateInset();
      setKeyboardOpen(false);
    });
    return () => {
      t.forEach(clearTimeout);
      show.remove();
      hide.remove();
    };
  }, []);

  // Once the padding has landed (and the tagline has collapsed), bring the
  // focused field into view.
  useEffect(() => {
    if (kbInset > 0) later(revealFocused, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbInset]);

  // Hopping between fields with the keyboard already up.
  function onFieldFocus() {
    if (kbHeight.current > 0) later(revealFocused, 80);
  }

  useEffect(() => {
    tabPos.value = withSpring(isRegister ? 1 : 0, SNAPPY);
    step.value = withSpring(mode === 'password' ? 1 : 0, SNAPPY);
  }, [isRegister, mode, tabPos, step]);

  // Slide the new mode's content in right after it commits — no exit phase to
  // wait on, so a tap switches instantly.
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    contentO.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 180 }));
    contentX.value = withSequence(
      withTiming(dirRef.current * 32, { duration: 0 }),
      withSpring(0, SNAPPY),
    );
    focusNext.current?.current?.focus();
    focusNext.current = null;
  }, [mode, contentO, contentX]);

  // Android back walks the flow backwards before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'password') {
        go('email');
        return true;
      }
      if (mode === 'email') {
        go('login');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  function go(next: Mode) {
    const from = modeRef.current;
    if (next === from) return;
    dirRef.current = ORDER[next] > ORDER[from] ? 1 : -1;
    modeRef.current = next;
    setMode(next);
    setError('');
    if (next !== 'password') setConfirm('');
  }

  function bumpOrb() {
    pulse.value = withSequence(
      withTiming(1.07, { duration: 70 }),
      withSpring(1, { damping: 7, stiffness: 180 }),
    );
  }

  function showError(msg: string) {
    setError(msg);
    haptics.warn();
    shake.value = withSequence(
      withTiming(1, { duration: 45 }),
      withTiming(-1, { duration: 45 }),
      withTiming(0.6, { duration: 45 }),
      withTiming(-0.6, { duration: 45 }),
      withTiming(0, { duration: 45 }),
    );
  }

  function finish(kind: DoneKind, token: string, user: AuthUser) {
    haptics.success();
    Keyboard.dismiss();
    setDoneKind(kind);
    go('done');
    // Let the success moment land before RootNavigator fades to Home.
    later(() => {
      loginStore(token, user).catch(() => {
        go('login');
        showError('შენახვა ვერ მოხერხდა, სცადე კიდევ');
      });
    }, SUCCESS_HOLD_MS);
  }

  async function submit() {
    if (loading) return;
    setError('');

    if (mode === 'email') {
      if (!emailValid) return showError('შეიყვანე სწორი ელ. ფოსტა');
      focusNext.current = pwRef;
      go('password');
      return;
    }
    if (!emailValid) return showError('შეიყვანე სწორი ელ. ფოსტა');
    if (mode === 'login' && !password) return showError('შეიყვანე პაროლი');
    if (mode === 'password') {
      if (!pwLongEnough) return showError('პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს');
      if (!pwMatch) return showError('პაროლები არ ემთხვევა');
    }

    setLoading('submit');
    try {
      const { token, user } =
        mode === 'login'
          ? await authApi.login(trimmedEmail, password)
          : await authApi.register(trimmedEmail, password);
      finish(mode === 'login' ? 'login' : 'register', token, user);
    } catch (err) {
      showError(authErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function continueAsGuest() {
    if (loading) return;
    haptics.tap();
    setError('');
    setLoading('guest');
    try {
      const { token, user } = await authApi.guest();
      finish('guest', token, user);
    } catch (err) {
      showError(authErrorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentO.value,
    transform: [{ translateX: contentX.value }],
  }));
  const pillStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: tabPos.value * ((trackW - 8) / 2) }] }),
    [trackW],
  );
  const stepFillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: step.value }],
  }));
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value * 9 }],
  }));

  const copy = mode === 'done' ? null : COPY[mode];
  const layoutSpring = LinearTransition.springify().damping(24).stiffness(340).mass(0.8);

  return (
    <View
      ref={rootRef}
      style={styles.root}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        rootH.current = h;
        if (kbHeight.current === 0) restH.current = h;
        else updateInset();
      }}
    >
      <AuthBackdrop />

      {/* The page is one screen tall and does not scroll at rest: content
          centers vertically. While the keyboard is up the content gets
          bottom padding for it (see updateInset) and scrolling unlocks, so
          the focused field can always be reached. No KeyboardAvoidingView —
          stacked on adjustResize it caused an open→relayout→blur→close loop. */}
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: Math.max(insets.bottom, kbInset) + spacing.lg,
          },
        ]}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        scrollEnabled={keyboardOpen}
        bounces={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand ────────────────────────────────────────── */}
        <Reanimated.View
          entering={FadeInDown.delay(60)
            .duration(ENTER_MS)
            .easing(EASE_OUT)
            .withInitialValues({ transform: [{ translateY: -10 }] })}
          layout={layoutSpring}
          style={styles.brand}
        >
          <MiaWordmark size={38} />
          {!keyboardOpen ? <Text style={styles.tagline}>შენი ხმოვანი ასისტენტი</Text> : null}
        </Reanimated.View>

        {/* ── Card ─────────────────────────────────────────── */}
        <Reanimated.View
          entering={FadeInUp.delay(140)
            .duration(ENTER_MS)
            .easing(EASE_OUT)
            .withInitialValues({ transform: [{ translateY: 16 }] })}
          layout={layoutSpring}
          style={styles.card}
        >
          {/* Brand wash across the top edge; fixed height so it never has to
              follow the card's animated frame. */}
          <LinearGradient
            colors={['rgba(109,59,245,0.22)', 'rgba(255,77,139,0.06)', 'rgba(22,23,40,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.6, y: 1 }}
            style={styles.cardWash}
            pointerEvents="none"
          />

          {mode !== 'done' ? (
            <Reanimated.View exiting={FadeOut.duration(120)}>
              {/* Segmented switch */}
              <View style={styles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
                {trackW > 0 ? (
                  <Reanimated.View style={[styles.pill, { width: (trackW - 8) / 2 }, pillStyle]}>
                    <LinearGradient
                      colors={['rgba(109,59,245,0.35)', 'rgba(255,77,139,0.28)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Reanimated.View>
                ) : null}
                <Pressable
                  style={styles.tabBtn}
                  onPress={() => go('login')}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: !isRegister }}
                >
                  <Text style={[styles.tabText, !isRegister && styles.tabTextOn]}>შესვლა</Text>
                </Pressable>
                <Pressable
                  style={styles.tabBtn}
                  onPress={() => !isRegister && go('email')}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isRegister }}
                >
                  <Text style={[styles.tabText, isRegister && styles.tabTextOn]}>რეგისტრაცია</Text>
                </Pressable>
              </View>

              {/* Register progress */}
              {isRegister ? (
                <Reanimated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)} style={styles.progress}>
                  <View style={styles.progressBars}>
                    <View style={[styles.progressSeg, styles.progressSegOn]} />
                    <View style={styles.progressSeg}>
                      <Reanimated.View style={[styles.progressFill, stepFillStyle]} />
                    </View>
                  </View>
                  <Text style={styles.progressText}>
                    ნაბიჯი {mode === 'password' ? 2 : 1} / 2
                  </Text>
                </Reanimated.View>
              ) : null}
            </Reanimated.View>
          ) : null}

          <Reanimated.View style={contentStyle}>
            {mode === 'done' ? (
              <SuccessBurst {...DONE_COPY[doneKind]} />
            ) : (
              <>
                <Text style={styles.title}>{copy!.title}</Text>
                {mode === 'password' ? (
                  <Pressable onPress={() => go('email')} hitSlop={8} style={styles.emailChip}>
                    <ArrowIcon color={colors.textMuted} direction="left" size={14} />
                    <Text numberOfLines={1} style={styles.emailChipText}>{trimmedEmail}</Text>
                    <Text style={styles.emailChipEdit}>შეცვლა</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.subtitle}>{copy!.subtitle}</Text>
                )}

                <View style={styles.fields}>
                  {mode !== 'password' ? (
                    <AuthField
                      ref={emailRef}
                      onFocus={onFieldFocus}
                      label="ელ. ფოსტა"
                      icon="mail"
                      value={email}
                      valid={emailValid}
                      invalid={!!error && !emailValid}
                      onChangeText={(v) => {
                        setEmail(v);
                        bumpOrb();
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      keyboardType="email-address"
                      returnKeyType={mode === 'login' ? 'next' : 'go'}
                      submitBehavior={mode === 'login' ? 'submit' : 'blurAndSubmit'}
                      onSubmitEditing={mode === 'login' ? () => pwRef.current?.focus() : submit}
                    />
                  ) : null}

                  {mode !== 'email' ? (
                    <AuthField
                      ref={pwRef}
                      onFocus={onFieldFocus}
                      label={mode === 'login' ? 'პაროლი' : 'ახალი პაროლი'}
                      icon="lock"
                      secure
                      value={password}
                      invalid={!!error && mode === 'password' && !pwLongEnough}
                      onChangeText={(v) => {
                        setPassword(v);
                        bumpOrb();
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete={mode === 'login' ? 'password' : 'new-password'}
                      textContentType={mode === 'login' ? 'password' : 'newPassword'}
                      returnKeyType={mode === 'login' ? 'go' : 'next'}
                      submitBehavior={mode === 'login' ? 'blurAndSubmit' : 'submit'}
                      onSubmitEditing={mode === 'login' ? submit : () => confirmRef.current?.focus()}
                    />
                  ) : null}

                  {mode === 'password' ? (
                    <>
                      <PasswordStrength password={password} />
                      {/* The green check inside this field doubles as the
                          "passwords match" indicator. */}
                      <AuthField
                        ref={confirmRef}
                        onFocus={onFieldFocus}
                        label="გაიმეორე პაროლი"
                        icon="shield"
                        secure
                        value={confirm}
                        valid={pwMatch && pwLongEnough}
                        invalid={!!error && !pwMatch}
                        onChangeText={(v) => {
                          setConfirm(v);
                          bumpOrb();
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        returnKeyType="go"
                        submitBehavior="blurAndSubmit"
                        onSubmitEditing={submit}
                      />
                    </>
                  ) : null}
                </View>

                {/* Enter/exit on the wrapper, shake on the box: both drive
                    transform, so they can't share a view. */}
                {error ? (
                  <Reanimated.View
                    entering={FadeInDown.springify().damping(16)}
                    exiting={FadeOut.duration(120)}
                  >
                    <Reanimated.View style={[styles.errorBox, shakeStyle]}>
                      <Text style={styles.errorText}>{error}</Text>
                    </Reanimated.View>
                  </Reanimated.View>
                ) : null}

                <GradientButton
                  label={copy!.cta}
                  onPress={submit}
                  loading={loading === 'submit'}
                  ready={ready}
                />

                <Pressable
                  onPress={() => go(mode === 'login' ? 'email' : 'login')}
                  hitSlop={8}
                  style={styles.switchHint}
                >
                  <Text style={styles.switchHintText}>
                    {mode === 'login' ? 'ჯერ არ გაქვს ანგარიში? ' : 'უკვე გაქვს ანგარიში? '}
                    <Text style={styles.switchHintAccent}>
                      {mode === 'login' ? 'შექმენი' : 'შედი'}
                    </Text>
                  </Text>
                </Pressable>
              </>
            )}
          </Reanimated.View>
        </Reanimated.View>

        {/* ── Dev-only guest session ───────────────────────── */}
        {__DEV__ && (mode === 'login' || mode === 'email') ? (
          <Reanimated.View
            entering={FadeIn.delay(320).duration(ENTER_MS).easing(EASE_OUT)}
            exiting={FadeOut.duration(120)}
            layout={layoutSpring}
          >
            <Pressable
              onPress={continueAsGuest}
              disabled={!!loading}
              style={({ pressed }) => [styles.guestBtn, pressed && styles.guestBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="სტუმრად შესვლა"
            >
              <SparkIcon color={colors.primary} />
              <Text style={styles.guestText}>
                {loading === 'guest' ? 'იტვირთება…' : 'სტუმრად შესვლა'}
              </Text>
              <View style={styles.devChip}>
                <Text style={styles.devChipText}>DEV</Text>
              </View>
            </Pressable>
          </Reanimated.View>
        ) : null}
      </ScrollView>

      {/* Status-bar orb beside the Dynamic Island; above the scroll view so it
          draws over the status bar. */}
      <IslandOrb pulse={pulse} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgDeep,
  },
  flex: {
    flex: 1,
  },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  // ── Brand ─────────────────────────────────────────────────
  brand: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  tagline: {
    ...typography.bodySmall,
    color: colors.textMuted,
    letterSpacing: 0.4,
  },

  // ── Card ──────────────────────────────────────────────────
  // Per-side border colors fake a violet → coral gradient rim that belongs to
  // the view itself, so it follows the layout transition exactly.
  card: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderTopColor: 'rgba(109,59,245,0.55)',
    borderLeftColor: 'rgba(140,70,240,0.4)',
    borderRightColor: 'rgba(255,77,139,0.3)',
    borderBottomColor: 'rgba(255,107,61,0.18)',
    backgroundColor: 'rgba(22,23,40,0.95)',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    overflow: 'hidden',
    shadowColor: colors.secondary,
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  cardWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },

  // ── Segmented switch ──────────────────────────────────────
  track: {
    flexDirection: 'row',
    height: 44,
    padding: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  pill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.strokeBrand,
    backgroundColor: colors.surfaceElev,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.outline,
  },
  tabTextOn: {
    color: colors.text,
  },

  // ── Register progress ─────────────────────────────────────
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  progressBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  progressSeg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressSegOn: {
    backgroundColor: colors.primary,
  },
  progressFill: {
    flex: 1,
    backgroundColor: colors.primary,
    transformOrigin: 'left center',
  },
  progressText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
  },

  // ── Content ───────────────────────────────────────────────
  title: {
    ...typography.title,
    fontSize: 21,
    lineHeight: 28,
    color: colors.text,
    marginTop: spacing.lg,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 4,
  },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    maxWidth: '100%',
    marginTop: spacing.sm,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  emailChipText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
  },
  emailChipEdit: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.primary,
  },
  fields: {
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },

  // ── Error ─────────────────────────────────────────────────
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerStroke,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.dangerSoft,
    textAlign: 'center',
  },

  // ── Switch hint ───────────────────────────────────────────
  switchHint: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  switchHintText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  switchHintAccent: {
    color: colors.primary,
    fontFamily: fonts.bodyBold,
  },

  // ── Guest ─────────────────────────────────────────────────
  guestBtn: {
    height: 46,
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  guestBtnPressed: {
    backgroundColor: 'rgba(255,77,139,0.08)',
    borderColor: colors.strokeBrand,
  },
  guestText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
  },
  devChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,210,138,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,138,0.4)',
  },
  devChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.warning,
  },
});
