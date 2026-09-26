import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// Stroke icons for the auth flow — 24-unit grid, 1.8 stroke, round caps.

export type IconName = 'mail' | 'lock' | 'shield';

const stroke = { strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function FieldIcon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'mail' ? (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={3.5} stroke={color} {...stroke} />
          <Path d="m4 7.5 6.6 4.6a2.4 2.4 0 0 0 2.8 0L20 7.5" stroke={color} {...stroke} />
        </>
      ) : name === 'lock' ? (
        <>
          <Rect x={4.5} y={10.5} width={15} height={10} rx={3} stroke={color} {...stroke} />
          <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={color} {...stroke} />
          <Circle cx={12} cy={15.5} r={1.3} fill={color} />
        </>
      ) : (
        <>
          <Path
            d="M12 3.5 5 6.3v5.3c0 4.2 2.9 7.6 7 8.9 4.1-1.3 7-4.7 7-8.9V6.3L12 3.5Z"
            stroke={color}
            {...stroke}
          />
          <Path d="m9.2 12.2 2 2 3.8-4" stroke={color} {...stroke} />
        </>
      )}
    </Svg>
  );
}

export function EyeIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" stroke={color} {...stroke} />
      <Circle cx={12} cy={12} r={2.6} stroke={color} strokeWidth={1.8} />
      {!open ? <Line x1={4} y1={20} x2={20} y2={4} stroke={color} {...stroke} /> : null}
    </Svg>
  );
}

export function CheckIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} fill={color} opacity={0.16} />
      <Path d="m7.5 12.3 3 3 6-6.3" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ArrowIcon({ color, direction = 'right', size = 18 }: { color: string; direction?: 'left' | 'right'; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={direction === 'right' ? 'M5 12h14m-5-5 5 5-5 5' : 'M19 12H5m5-5-5 5 5 5'}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SparkIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3c.5 4.2 2.8 6.5 7 7-4.2.5-6.5 2.8-7 7-.5-4.2-2.8-6.5-7-7 4.2-.5 6.5-2.8 7-7Z"
        fill={color}
      />
      <Path d="M19 16c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z" fill={color} />
    </Svg>
  );
}
