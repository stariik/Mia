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
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useToolsStore } from '@/stores/toolsStore';
import {
  dismissAlarm,
  setLockScreenFlags,
  snoozeAlarm,
} from '@/lib/tools/platform/native';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radius, spacing, typography } from '@/theme';

const VIBRATE_PATTERN = [0, 800, 400, 800, 400, 800];

type Props = {
  route: { params?: { alarmId: string } };
  navigation: { goBack: () => void; canGoBack: () => boolean; navigate: (n: string) => void };
};

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

  useEffect(() => {
    // Keep the alarm visible over the keyguard while ringing; cleared on
    // unmount so the flags don't linger and break keyboard focus elsewhere.
    setLockScreenFlags(true);
    Vibration.vibrate(VIBRATE_PATTERN, true);
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 700, easing: Easing.in(Easing.cubic) }),
      ),
      -1,
      false,
    );
    return () => {
      setLockScreenFlags(false);
      Vibration.cancel();
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.08 }],
    opacity: 0.35 + pulse.value * 0.4,
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
    <LinearGradient
      colors={['#1a0410', colors.bgDeep]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />

        <View style={styles.center}>
          <Animated.View style={[styles.glow, pulseStyle]} />
          <Text style={styles.label}>მაღვიძარა</Text>
          <Text style={styles.time}>{timeText}</Text>
          {display?.label ? (
            <Text style={styles.title}>{display.label}</Text>
          ) : (
            <Text style={styles.title}>გაღვიძების დროა</Text>
          )}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onSnooze}
            style={({ pressed }) => [
              styles.btn,
              styles.snooze,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={[typography.title, styles.btnText]}>გადავადება</Text>
            <Text style={[typography.bodySmall, styles.btnSub]}>9 წუთით</Text>
          </Pressable>

          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.btn,
              styles.dismiss,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={[typography.title, styles.btnDismissText]}>
              გაჩერება
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: colors.dangerBg,
  },
  label: {
    ...typography.labelSm,
    color: colors.warning,
    marginBottom: spacing.lg,
  },
  time: {
    fontFamily: fonts.numeric,
    fontSize: 96,
    lineHeight: 100,
    letterSpacing: -2,
    color: colors.text,
  },
  title: {
    ...typography.bodyLg,
    color: colors.textMuted,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  btn: {
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { opacity: 0.85 },
  snooze: {
    backgroundColor: 'rgba(255,210,138,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,138,0.45)',
  },
  dismiss: {
    backgroundColor: colors.danger,
  },
  btnText: {
    color: colors.warning,
  },
  btnSub: {
    color: colors.textMuted,
    marginTop: 2,
  },
  btnDismissText: {
    color: '#fff',
  },
});
