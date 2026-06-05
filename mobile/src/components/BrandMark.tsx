import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors, radius } from '@/theme';

type Props = {
  size?: number;
};

/**
 * Mia brand mark — a tiny glowing orb, echoing the hero WebGL orb.
 * Used in headers and any place a logo is needed.
 */
export function BrandMark({ size = 40 }: Props) {
  const inner = Math.round(size * 0.62);
  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Svg width={inner} height={inner} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="bm" cx="35" cy="35" r="65">
            <Stop offset="0%" stopColor={colors.gradientStart} stopOpacity={1} />
            <Stop offset="55%" stopColor={colors.gradientMid} stopOpacity={0.92} />
            <Stop offset="100%" stopColor={colors.gradientEnd} stopOpacity={0.78} />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="46" fill="url(#bm)" />
        <Circle cx="38" cy="36" r="10" fill="rgba(255,255,255,0.55)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,77,139,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,139,0.35)',
    borderRadius: radius.full,
  },
});
