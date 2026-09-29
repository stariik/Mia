import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { brandGradient, colors, fonts, radius } from '@/theme';

import { ArrowIcon } from './icons';

// Primary CTA: brand gradient, a springy press, and a label ↔ spinner
// crossfade while loading.

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  ready?: boolean;
};

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

export function GradientButton({ label, onPress, loading, ready = true }: Props) {
  const press = useSharedValue(0);

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.035 }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={loading}
      onPressIn={() => {
        press.value = withSpring(1, { damping: 20, stiffness: 400 });
      }}
      onPressOut={() => {
        press.value = withSpring(0, { damping: 12, stiffness: 260 });
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading }}
      style={[styles.btn, !ready && styles.btnIdle, btnStyle]}
    >
      <LinearGradient
        colors={[...brandGradient]}
        start={{ x: 0, y: 0.2 }}
        end={{ x: 1, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Top gloss for a subtle glassy bevel */}
      <LinearGradient
        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.6 }}
        style={StyleSheet.absoluteFill}
      />

      {loading ? (
        <Reanimated.View key="spin" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          <ActivityIndicator color="#fff" />
        </Reanimated.View>
      ) : (
        <Reanimated.View
          key={label}
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(60)}
          style={styles.row}
        >
          <Text style={styles.text}>{label}</Text>
          <View style={styles.arrow}>
            <ArrowIcon color="#fff" />
          </View>
        </Reanimated.View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: radius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 20,
    elevation: 8,
  },
  btnIdle: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.primaryOn,
    letterSpacing: 0.3,
  },
  arrow: {
    marginLeft: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
