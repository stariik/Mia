import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Text, TSpan } from 'react-native-svg';

import { colors } from '@/theme';

// In-app "Mia" wordmark echoing the logo's colour treatment: a violet → pink →
// coral gradient "M" with white "ia". (The logo's hand-painted script glyph
// can't be reproduced in a font, so this uses the brand font — same colours.)
export function MiaWordmark({ size = 22 }: { size?: number }) {
  const w = size * 2.5;
  const h = size * 1.35;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <LinearGradient id="miaGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.gradientStart} />
          <Stop offset="0.5" stopColor={colors.gradientMid} />
          <Stop offset="1" stopColor={colors.gradientEnd} />
        </LinearGradient>
      </Defs>
      <Text
        x={w / 2}
        y={size}
        textAnchor="middle"
        fontFamily="SpaceGrotesk-Bold"
        fontSize={size}
      >
        <TSpan fill="url(#miaGrad)">M</TSpan>
        <TSpan fill={colors.text}>ia</TSpan>
      </Text>
    </Svg>
  );
}
