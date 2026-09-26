import React, { useId } from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { colors, fonts } from '@/theme';

// "Mia" as one connected script word (Marck Script), filled with the brand
// violet → pink → coral gradient. Drawn as a single SVG text run so the
// letters join into one stroke; the script's capital M is naturally the hero.

// Marck Script metrics per 1px of font size: "Mia" advances ~1.54, ink rises
// ~0.64 above the baseline and the strokes' tails dip ~0.14 below it.
const ADVANCE = 1.54;
const INK_TOP = 0.64;
const INK_BOTTOM = 0.14;
// Marck is small on its em square; this keeps the wordmark as tall as before.
const SIZE_TO_FONT = 1.6;

export function MiaWordmark({ size = 22 }: { size?: number }) {
  const gradId = `mia${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fontSize = Math.round(size * SIZE_TO_FONT);
  const padX = fontSize * 0.08; // swashes overhang the advance a little
  const padTop = fontSize * 0.12;
  const width = Math.ceil(fontSize * ADVANCE + padX * 2);
  const baseline = padTop + fontSize * INK_TOP;
  const height = Math.ceil(baseline + fontSize * (INK_BOTTOM + 0.06));

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
