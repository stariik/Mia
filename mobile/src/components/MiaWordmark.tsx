import React, { useId } from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { colors, fonts } from '@/theme';

// "Mia" set in Fredoka SemiBold — round, bubbly, friendly — filled with the
// brand violet → pink → coral gradient. Drawn as one SVG text run so the
// gradient sweeps across the whole word.

// Fredoka SemiBold metrics per 1px of font size: "Mia" advances ~1.62, ink
// rises ~0.72 above the baseline (the i's dot is the top) and sits on it.
const ADVANCE = 1.62;
const INK_TOP = 0.72;
// Fredoka is heavy and round, so it reads bigger than its cap height; this
// keeps the wordmark in proportion with the header icons.
const SIZE_TO_FONT = 1.35;

export function MiaWordmark({ size = 22 }: { size?: number }) {
  const gradId = `mia${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fontSize = Math.round(size * SIZE_TO_FONT);
  const padX = fontSize * 0.04;
  // Even padding above and below the ink keeps the word optically centred
  // wherever the box is centred.
  const padY = fontSize * 0.1;
  const width = Math.ceil(fontSize * ADVANCE + padX * 2);
  const baseline = padY + fontSize * INK_TOP;
  const height = Math.ceil(baseline + padY);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2={width} y2={height * 0.5} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.gradientStart} />
          <Stop offset="0.55" stopColor={colors.gradientMid} />
          <Stop offset="1" stopColor={colors.gradientEnd} />
        </LinearGradient>
      </Defs>
      <SvgText
        x={padX}
        y={baseline}
        fontFamily={fonts.brand}
        fontSize={fontSize}
        fill={`url(#${gradId})`}
      >
        Mia
      </SvgText>
    </Svg>
  );
}
