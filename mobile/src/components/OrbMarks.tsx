import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, G, Path } from 'react-native-svg';

import {
  HALF_DAY,
  arcPath,
  dialAngle,
  localOffsetMs,
  pointAt,
  timerProgress,
  urgency,
} from '@/lib/orbMarks';
import { ORB_CONFIG } from '@/orb';
import {
  useToolsStore,
  type ActiveAlarm,
  type ActiveTimer,
} from '@/stores/toolsStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { duration, easeOut } from '@/theme';

// Timers and alarms as light caught just outside the orb's glass, in the
// orb's own soft tints. They never sit inside the sphere and never draw a full
// ring, so they read as part of the orb's halo, not as a gauge stuck on it.
//
//   Timer — a round pearl that travels clockwise from 12 o'clock as time
//   elapses, trailing nothing; ahead of it a faint arc shows the time still
//   left, shrinking to nothing at 12. It breathes slowly.
//   Alarm — a short radial notch at its ring time on a 12-hour dial (like an
//   hour mark), steady. Within 12 hours a hairline runs from "now" (an
//   hour-hand position) to the notch and shrinks as the alarm approaches.
//
// Every frame reads the wall clock on the UI thread (useFrameCallback), so the
// motion is continuous at display rate and React renders only when a timer
// or alarm is added or removed. In the last stretch (10 s for a timer, a
// minute for an alarm) the glow builds gently. Marks fade in and out.

const P = ORB_CONFIG.palette;
const TAU = Math.PI * 2;

// Fractions of the orb box (the glass edge sits at 0.43).
const TIMER_R = 0.458;
const ALARM_R = 0.482;
// The SVG overhangs the orb box so glows are never clipped.
const PAD = 18;

const TIMER_FINAL_MS = 10_000;
const ALARM_FINAL_MS = 60_000;

type Clock = SharedValue<number>;

// ── Presence: keep a removed item drawn until it has faded out ───────────

type Shown<T> = { item: T; leaving: boolean };

function usePresence<T extends { id: string }>(items: T[]) {
  const [shown, setShown] = useState<Shown<T>[]>(() =>
    items.map((item) => ({ item, leaving: false })),
  );
  useEffect(() => {
    setShown((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const next: Shown<T>[] = prev.map((s) =>
        ids.has(s.item.id)
          ? { item: items.find((i) => i.id === s.item.id)!, leaving: false }
          : { item: s.item, leaving: true },
      );
      for (const item of items) {
        if (!prev.some((s) => s.item.id === item.id)) {
          next.push({ item, leaving: false });
        }
      }
      return next;
    });
  }, [items]);
  const remove = useRef((id: string) =>
    setShown((prev) => prev.filter((s) => s.item.id !== id || !s.leaving)),
  ).current;
  return [shown, remove] as const;
}

/** 0 → 1 on mount, back to 0 when leaving, then `onGone`. */
function useFade(leaving: boolean, id: string, onGone: (id: string) => void) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(
      leaving ? 0 : 1,
      { duration: duration.slow, easing: easeOut },
      (finished) => {
        if (finished && leaving) scheduleOnRN(onGone, id);
      },
    );
  }, [leaving, id, onGone, v]);
  return v;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

type MarkProps = {
  c: number;
  r: number;
  clock: Clock;
  calm: SharedValue<number>;
  still: boolean;
  leaving: boolean;
  onGone: (id: string) => void;
};

function TimerMark({
  timer,
  c,
  r,
  clock,
  calm,
  still,
  leaving,
  onGone,
}: MarkProps & { timer: ActiveTimer }) {
  const fade = useFade(leaving, timer.id, onGone);
  const startedAt = timer.startedAt ?? timer.endsAt;
  const endsAt = timer.endsAt;
  // Desynchronise several timers' breathing.
  const phase = (timer.endsAt % 9973) / 9973;

  const groupProps = useAnimatedProps(() => ({
    opacity: fade.value * (1 - 0.35 * calm.value),
  }));
  const trackProps = useAnimatedProps(() => {
    const a = timerProgress(clock.value, startedAt, endsAt) * TAU;
    return { d: arcPath(c, c, r, a, TAU - a) };
  });
  // The glow: three soft discs with falling opacity (a gradient fill would
  // be smoother but doesn't render on every SVG backend while animated).
  const glow = (scale: number, alpha: number) => {
    'worklet';
    const now = clock.value;
    const p = pointAt(c, c, r, timerProgress(now, startedAt, endsAt) * TAU);
    const u = urgency(endsAt - now, TIMER_FINAL_MS);
    const breath = still ? 0 : 0.5 + 0.5 * Math.sin((now / 4200 + phase) * TAU);
    return {
      cx: p.x,
      cy: p.y,
      r: (5 + 1.5 * breath + 4 * u) * scale,
      opacity: alpha * (0.7 + 0.3 * breath + 0.6 * u),
    };
  };
  const glowOuter = useAnimatedProps(() => glow(2.2, 0.07));
  const glowMid = useAnimatedProps(() => glow(1.4, 0.13));
  const glowInner = useAnimatedProps(() => glow(0.9, 0.24));
  const pearlProps = useAnimatedProps(() => {
    const now = clock.value;
    const p = pointAt(c, c, r, timerProgress(now, startedAt, endsAt) * TAU);
    return { cx: p.x, cy: p.y, r: 2.6 + 0.8 * urgency(endsAt - now, TIMER_FINAL_MS) };
  });

  return (
    <AnimatedG animatedProps={groupProps}>
      {/* Time left: a hairline over a soft wash, like light along the glass. */}
      <AnimatedPath
        animatedProps={trackProps}
        stroke={P.pink}
        strokeOpacity={0.07}
        strokeWidth={6}
        strokeLinecap="round"
        fill="none"
      />
      <AnimatedPath
        animatedProps={trackProps}
        stroke={P.violetSoft}
        strokeOpacity={0.14}
        strokeWidth={1}
        strokeLinecap="round"
        fill="none"
      />
      <AnimatedCircle animatedProps={glowOuter} fill={P.pink} />
      <AnimatedCircle animatedProps={glowMid} fill={P.pink} />
      <AnimatedCircle animatedProps={glowInner} fill={P.pinkSoft} />
      <AnimatedCircle animatedProps={pearlProps} fill={P.pinkSoft} />
    </AnimatedG>
  );
}

function AlarmMark({
  alarm,
  c,
  r,
  clock,
  calm,
  still,
  leaving,
  onGone,
  tz,
}: MarkProps & { alarm: ActiveAlarm; tz: number }) {
  const fade = useFade(leaving, alarm.id, onGone);
  const ringsAt = alarm.ringsAt;
  const angle = dialAngle(ringsAt, tz);
  // A short radial notch, like an hour mark on a dial.
  const inner = pointAt(c, c, r - 3.5, angle);
  const outer = pointAt(c, c, r + 3.5, angle);
  const notch = `M${inner.x.toFixed(2)} ${inner.y.toFixed(2)}L${outer.x.toFixed(2)} ${outer.y.toFixed(2)}`;
  const mid = pointAt(c, c, r, angle);

  const groupProps = useAnimatedProps(() => ({
    opacity: fade.value * (1 - 0.35 * calm.value),
  }));
  // From the hour hand's position now to the notch; shrinks as time runs out.
  const leadProps = useAnimatedProps(() => {
    const left = ringsAt - clock.value;
    if (left <= 0 || left >= HALF_DAY) return { d: 'M0 0' };
    return { d: arcPath(c, c, r, dialAngle(clock.value, tz), (left / HALF_DAY) * TAU) };
  });
  const glow = (scale: number, alpha: number) => {
    'worklet';
    const now = clock.value;
    const u = urgency(ringsAt - now, ALARM_FINAL_MS);
    // Only the final minute breathes, slowly, and only as much as it builds.
    const pulse = still ? 0 : (0.5 + 0.5 * Math.sin((now / 2200) * TAU)) * u;
    return {
      r: (5 + 4 * u + 1.5 * pulse) * scale,
      opacity: alpha * (0.6 + 0.9 * u + 0.3 * pulse),
    };
  };
  const glowOuter = useAnimatedProps(() => glow(1.8, 0.06));
  const glowInner = useAnimatedProps(() => glow(1, 0.14));

  return (
    <AnimatedG animatedProps={groupProps}>
      <AnimatedPath
        animatedProps={leadProps}
        stroke={P.violetSoft}
        strokeOpacity={0.09}
        strokeWidth={1}
        strokeLinecap="round"
        fill="none"
      />
      <AnimatedCircle cx={mid.x} cy={mid.y} animatedProps={glowOuter} fill={P.violet} />
      <AnimatedCircle cx={mid.x} cy={mid.y} animatedProps={glowInner} fill={P.violetSoft} />
      <Path
        d={notch}
        stroke={P.violetSoft}
        strokeOpacity={0.9}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </AnimatedG>
  );
}

export function OrbMarks({ size }: { size: number }) {
  const timers = useToolsStore((s) => s.timers);
  const alarms = useToolsStore((s) => s.alarms);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const reduceMotion = useReducedMotion();
  const [shownTimers, removeTimer] = usePresence(timers);
  const [shownAlarms, removeAlarm] = usePresence(alarms);
  const tz = useMemo(() => localOffsetMs(), [alarms]); // eslint-disable-line react-hooks/exhaustive-deps

  const clock = useSharedValue(Date.now());
  const anything = shownTimers.length + shownAlarms.length > 0;
  const frame = useFrameCallback(() => {
    clock.value = Date.now();
  }, false);
  useEffect(() => {
    frame.setActive(anything);
  }, [anything, frame]);

  // Marks step back while Mia speaks, letting the orb have the moment.
  const calm = useSharedValue(0);
  useEffect(() => {
    calm.value = withTiming(isSpeaking ? 1 : 0, { duration: duration.mode });
  }, [isSpeaking, calm]);

  if (!anything) return null;

  const box = size + PAD * 2;
  const c = box / 2;
  const common = { c, clock, calm, still: reduceMotion };

  return (
    <View
      pointerEvents="none"
      style={[styles.overlay, { width: box, height: box, left: -PAD, top: -PAD }]}
    >
      <Svg width={box} height={box}>
        {shownAlarms.map(({ item, leaving }) => (
          <AlarmMark
            key={item.id}
            alarm={item}
            r={size * ALARM_R}
            tz={tz}
            leaving={leaving}
            onGone={removeAlarm}
            {...common}
          />
        ))}
        {shownTimers.map(({ item, leaving }) => (
          <TimerMark
            key={item.id}
            timer={item}
            r={size * TIMER_R}
            leaving={leaving}
            onGone={removeTimer}
            {...common}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute' },
});
