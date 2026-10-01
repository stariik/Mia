import React, { useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useToolsStore } from '@/stores/toolsStore';
import {
  dismissAlarm,
  setLockScreenFlags,
  snoozeAlarm,
} from '@/lib/tools/platform/native';
import { haptics } from '@/lib/haptics';
import type { RootStackParamList } from '@/navigation/navigationRef';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const VIBRATE_PATTERN = [0, 800, 400, 800, 400, 800];

type Props = NativeStackScreenProps<RootStackParamList, 'AlarmRing'>;

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function AlarmRingScreen({ route, navigation }: Props) {
  const alarmId = route.params?.alarmId ?? '';
  const alarm = useToolsStore((s) => s.alarms.find((a) => a.id === alarmId));
  const onClose = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Home');
  };
  // Snapshot the time/label so a recurring alarm rolling forward
  // mid-ring doesn't change what the user sees.
  const snapshot = useRef(alarm).current;
  const display = alarm ?? snapshot;

  const pulse = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // Keep the alarm visible over the keyguard while ringing; cleared on
    // unmount so the flags don't linger and break keyboard focus elsewhere.
    setLockScreenFlags(true);
    Vibration.vibrate(VIBRATE_PATTERN, true);
    // A slow swell, not a flash: the vibration and the sound do the waking.
    pulse.value = reduceMotion
      ? 0.6
      : withRepeat(
          withSequence(
            withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          false,
        );
    return () => {
      setLockScreenFlags(false);
      Vibration.cancel();
      cancelAnimation(pulse);
    };
  }, [pulse, reduceMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.92 + pulse.value * 0.1 }],
    opacity: 0.55 + pulse.value * 0.45,
  }));

  const onSnooze = async () => {
    Vibration.cancel();
    haptics.tap();
    await snoozeAlarm(alarmId);
    onClose();
  };

  const onDismiss = async () => {
    Vibration.cancel();
    haptics.success();
    await dismissAlarm(alarmId);
    onClose();
  };

  const timeText = useMemo(
    () => (display ? formatTime(display.ringsAt) : '--:--'),
    [display],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />

        <View style={styles.center}>
          <Animated.View style={[styles.glow, pulseStyle]} pointerEvents="none">
            <Svg width={GLOW} height={GLOW}>
              <Defs>
                <RadialGradient id="ringGlow">
                  <Stop offset="0" stopColor={colors.gradientMid} stopOpacity={0.32} />
                  <Stop offset="0.55" stopColor={colors.gradientStart} stopOpacity={0.12} />
                  <Stop offset="1" stopColor={colors.gradientStart} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2} fill="url(#ringGlow)" />
            </Svg>
          </Animated.View>
          <Text style={styles.label}>მაღვიძარა</Text>
          <Text style={styles.time} accessibilityRole="header">
            {timeText}
          </Text>
          <Text style={styles.title}>
            {display?.label ? display.label : 'გაღვიძების დროა'}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btn, styles.dismiss, pressed && styles.btnPressed]}
          >
            <Text style={styles.dismissText}>გაჩერება</Text>
          </Pressable>
          <Pressable
            onPress={onSnooze}
            accessibilityRole="button"
            accessibilityHint="9 წუთით"
            style={({ pressed }) => [styles.btn, styles.snooze, pressed && styles.btnPressed]}
          >
            <Text style={styles.snoozeText}>გადადება · 9 წუთი</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const GLOW = 380;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  safe: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW,
    height: GLOW,
  },
  label: {
    ...typography.label,
    color: colors.textFaint,
    marginBottom: spacing.md,
  },
  time: {
    ...typography.numeric,
    fontFamily: fonts.body,
    fontSize: 88,
    lineHeight: 100,
    letterSpacing: -2,
    color: colors.text,
  },
  title: {
    ...typography.reading,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  btn: {
    minHeight: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { opacity: 0.85 },
  dismiss: { backgroundColor: colors.primary },
  dismissText: {
    ...typography.title,
    fontSize: 18,
    color: colors.primaryOn,
  },
  snooze: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
  },
  snoozeText: {
    ...typography.bodyMedium,
    fontSize: 16,
    color: colors.text,
  },
});
