import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, fonts, radius, spacing } from '@/theme';

type ToolKey = 'translate' | 'timer' | 'alarm' | 'settings';

// Color-coded so each tool is recognizable at a glance, even without reading
// the label.
const META: Record<ToolKey, { label: string; color: string }> = {
  translate: { label: 'თარგმნა', color: colors.primary },
  timer: { label: 'ტაიმერი', color: colors.primary },
  alarm: { label: 'მაღვიძარა', color: colors.warning },
  settings: { label: 'პარამეტრები', color: colors.textMuted },
};

function ToolIcon({ tool, color }: { tool: ToolKey; color: string }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (tool) {
    case 'translate':
      return (
        <Svg {...common}>
          <Path d="M4 5h7" />
          <Path d="M7 4c0 4.5-2 7-4 8.5" />
          <Path d="M5 9c0 1.5 2.5 3.5 5 3.5" />
          <Path d="M13 20l4-9 4 9" />
          <Path d="M14.5 17h5" />
        </Svg>
      );
    case 'timer':
      return (
        <Svg {...common}>
          <Path d="M10 2h4" />
          <Path d="M12 14l3-3" />
          <Circle cx="12" cy="14" r="8" />
        </Svg>
      );
    case 'alarm':
      return (
        <Svg {...common}>
          <Path d="M5 4l-2 2" />
          <Path d="M19 4l2 2" />
          <Circle cx="12" cy="13" r="8" />
          <Path d="M12 9v4l2 2" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg {...common}>
          <Path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
          <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </Svg>
      );
  }
}

// A shallow, quick press-in and a slightly slower, overshoot-free release:
// the icon acknowledges the touch without bouncing while the screen opens.
const PRESS_IN = { duration: 90, easing: Easing.out(Easing.quad) };
const RELEASE = { duration: 220, easing: Easing.out(Easing.cubic) };

function ToolButton({ tool, onPress }: { tool: ToolKey; onPress: () => void }) {
  const meta = META[tool];
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.93, PRESS_IN);
        glow.value = withTiming(0.16, PRESS_IN);
      }}
      onPressOut={() => {
        scale.value = withTiming(1, RELEASE);
        glow.value = withTiming(0, RELEASE);
      }}
      onPress={() => {
        onPress();
      }}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={meta.label}
    >
      <Animated.View style={[styles.iconWrap, iconStyle]}>
        <Animated.View
          style={[styles.glow, { backgroundColor: meta.color }, glowStyle]}
        />
        <ToolIcon tool={tool} color={meta.color} />
      </Animated.View>
      <Text style={styles.label}>{meta.label}</Text>
    </Pressable>
  );
}

type Props = {
  onTranslate: () => void;
  onTimer: () => void;
  onAlarm: () => void;
  onSettings: () => void;
};

export function BottomToolBar({
  onTranslate,
  onTimer,
  onAlarm,
  onSettings,
}: Props) {
  return (
    <View style={styles.bar}>
      <ToolButton tool="translate" onPress={onTranslate} />
      <ToolButton tool="timer" onPress={onTimer} />
      <ToolButton tool="alarm" onPress={onAlarm} />
      <ToolButton tool="settings" onPress={onSettings} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.stroke,
    backgroundColor: 'rgba(6,6,18,0.55)',
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.xs,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: radius.lg,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.1,
  },
});
