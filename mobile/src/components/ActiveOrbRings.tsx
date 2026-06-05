import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import {
  useToolsStore,
  type ActiveAlarm,
  type ActiveTimer,
} from '@/stores/toolsStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { colors } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const URGENT_THRESHOLD_MS = 10_000;
const ALARM_IMMINENT_MS = 60_000;

// Two fixed concentric tracks: timers inner, alarms outer. Each track is drawn
// at most once; individual timers/alarms are dots ON the track (not their own
// ring). Fractions of `size`; kept clear of the edge so dots + halos don't clip.
const TIMER_R_FRAC = 0.42;
const ALARM_R_FRAC = 0.47;
const RING_BREATH_PX = 2.5; // radius "breath" amplitude

// One full revolution of the master clock takes 6s — slow enough to feel like
// breath, not animation.
const TIME_PERIOD_MS = 6000;

function clockAngleDeg(ts: number): number {
  const d = new Date(ts);
  const h = d.getHours() % 12;
  const m = d.getMinutes();
  return (h + m / 60) * 30 - 90;
}

type Shared = ReturnType<typeof useSharedValue<number>>;

// Shared "breathing" radius for a track — identical formula for the base ring
// and every dot on it, so the dots always sit exactly on the ring.
function breathRadius(timeVal: number, vital: number, baseR: number): number {
  'worklet';
  const breath = (Math.sin(timeVal * 1.6) * 0.5 + 0.5) * vital;
  return baseR + breath * RING_BREATH_PX;
}

// A single timer: a dot riding the timer track at its elapsed-progress angle
// (top = 0%, clockwise). Turns red in the final 10s.
function TimerDot({
  timer,
  index,
  cx,
  cy,
  baseR,
  time,
  vitality,
}: {
  timer: ActiveTimer;
  index: number;
  cx: number;
  cy: number;
  baseR: number;
  time: Shared;
  vitality: Shared;
}) {
  const endsAt = timer.endsAt;
  const startedAt = timer.startedAt ?? endsAt;
  const phase = index * 1.7;

  const compute = (sizeBase: number, sizePulse: number) => {
    'worklet';
    const r = breathRadius(time.value, vitality.value, baseR);
    const now = Date.now();
    const remaining = Math.max(0, endsAt - now);
    const urgent = remaining > 0 && remaining <= URGENT_THRESHOLD_MS;
    const color = urgent ? '#ff6e6e' : colors.primary;
    const total = endsAt - startedAt;
    const pct = total > 0 ? Math.min(1, Math.max(0, (now - startedAt) / total)) : 0;
    const angle = pct * 2 * Math.PI - Math.PI / 2;
    const pulse = (Math.sin(time.value * 2.4 + phase) * 0.5 + 0.5) * vitality.value;
    return {
      cx: cx + r * Math.cos(angle),
      cy: cy + r * Math.sin(angle),
      r: sizeBase + pulse * sizePulse,
      fill: color,
    };
  };

  const haloProps = useAnimatedProps(() => compute(4.8, 2.0));
  const dotProps = useAnimatedProps(() => compute(2.4, 1.4));

  return (
    <>
      <AnimatedCircle fillOpacity={0.3} animatedProps={haloProps} />
      <AnimatedCircle animatedProps={dotProps} />
    </>
  );
}

// A single alarm: a notch on the alarm track at the clock-angle of its ring
// time. Turns red when within a minute.
function AlarmDot({
  alarm,
  index,
  cx,
  cy,
  baseR,
  time,
  vitality,
}: {
  alarm: ActiveAlarm;
  index: number;
  cx: number;
  cy: number;
  baseR: number;
  time: Shared;
  vitality: Shared;
}) {
  const ringsAt = alarm.ringsAt;
  const phase = index * 1.4 + 0.6;
  const angleRad = (clockAngleDeg(ringsAt) * Math.PI) / 180;

  const compute = (sizeBase: number, sizePulse: number) => {
    'worklet';
    const r = breathRadius(time.value, vitality.value, baseR);
    const now = Date.now();
    const dt = ringsAt - now;
    const imminent = dt > 0 && dt <= ALARM_IMMINENT_MS;
    const color = imminent ? '#ff6e6e' : colors.warning;
    const pulse =
      (Math.sin(time.value * 2.0 + phase * 1.7) * 0.5 + 0.5) * vitality.value;
    return {
      cx: cx + r * Math.cos(angleRad),
      cy: cy + r * Math.sin(angleRad),
      r: sizeBase + pulse * sizePulse,
      fill: color,
    };
  };

  const haloProps = useAnimatedProps(() => compute(5.0, 2.0));
  const notchProps = useAnimatedProps(() => compute(2.6, 1.0));

  return (
    <>
      <AnimatedCircle fillOpacity={0.22} animatedProps={haloProps} />
      <AnimatedCircle animatedProps={notchProps} />
    </>
  );
}

export function ActiveOrbRings({ size }: { size: number }) {
  const timers = useToolsStore((s) => s.timers);
  const alarms = useToolsStore((s) => s.alarms);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);

  // Periodic re-render so React-side bookkeeping (dots appearing/disappearing
  // as items are added/expire) stays current. Smoothness comes from `time`.
  const [, setTick] = useState(0);
  const hasTimers = timers.length > 0;
  const hasAlarms = alarms.length > 0;
  const hasItems = hasTimers || hasAlarms;
  useEffect(() => {
    if (!hasItems) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [hasItems]);

  // Master clock for breath/pulse. Loops 0 → 2π linearly (no wrap discontinuity).
  const time = useSharedValue(0);
  useEffect(() => {
    time.value = 0;
    time.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: TIME_PERIOD_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
  }, [time]);

  // Rings hold still while Mia speaks, letting the orb's own animation breathe.
  const vitality = useSharedValue(1);
  useEffect(() => {
    vitality.value = withTiming(isSpeaking ? 0 : 1, { duration: 500 });
  }, [isSpeaking, vitality]);

  const cx = size / 2;
  const cy = size / 2;
  const timerR = size * TIMER_R_FRAC;
  const alarmR = size * ALARM_R_FRAC;

  const timerTrackProps = useAnimatedProps(() => ({
    r: breathRadius(time.value, vitality.value, timerR),
  }));
  const alarmTrackProps = useAnimatedProps(() => ({
    r: breathRadius(time.value, vitality.value, alarmR),
  }));

  if (!hasItems) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size}>
        {/* Timer track — drawn once; one dot per timer rides it. */}
        {hasTimers ? (
          <>
            <AnimatedCircle
              cx={cx}
              cy={cy}
              stroke={colors.primary}
              strokeOpacity={0.22}
              strokeWidth={1.25}
              fill="none"
              animatedProps={timerTrackProps}
            />
            {timers.map((t, i) => (
              <TimerDot
                key={`t-${t.id}`}
                timer={t}
                index={i}
                cx={cx}
                cy={cy}
                baseR={timerR}
                time={time}
                vitality={vitality}
              />
            ))}
          </>
        ) : null}

        {/* Alarm track — drawn once; one notch per alarm rides it. */}
        {hasAlarms ? (
          <>
            <AnimatedCircle
              cx={cx}
              cy={cy}
              stroke={colors.warning}
              strokeOpacity={0.18}
              strokeWidth={1}
              fill="none"
              animatedProps={alarmTrackProps}
            />
            {alarms.map((a, i) => (
              <AlarmDot
                key={`a-${a.id}`}
                alarm={a}
                index={i}
                cx={cx}
                cy={cy}
                baseR={alarmR}
                time={time}
                vitality={vitality}
              />
            ))}
          </>
        ) : null}
      </Svg>
    </View>
  );
}
