import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { colors } from '@/theme';

export function MiaWordmark({ size = 22 }: { size?: number }) {
  const mSize = Math.round(size * 1.3);
  // generous width so M doesn't clip; extra transparent space is invisible
  const svgW = Math.round(mSize * 1.05);

  return (
    <View style={styles.row}>
      {/* M — gradient purple → pink via SVG */}
      <Svg width={svgW} height={mSize} viewBox={`0 0 ${svgW} ${mSize}`}>
        <Defs>
          <LinearGradient id="mGrad" x1="0" y1="0" x2={svgW} y2="0" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.gradientStart} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.gradientMid} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <SvgText
          x={0}
          y={mSize * 0.86}
          fontFamily="Coiny-Regular"
          fontSize={mSize}
          fill="url(#mGrad)"
          textAnchor="start"
        >
          M
        </SvgText>
      </Svg>

      {/* ia — plain text, same font, smaller */}
      <Text style={[styles.ia, { fontSize: size, lineHeight: mSize }]}>ia</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  ia: {
    fontFamily: 'Coiny-Regular',
    color: colors.text,
    includeFontPadding: false,
  },
});
