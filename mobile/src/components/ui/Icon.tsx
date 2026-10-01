import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme';

// One icon family: a 24-unit grid, 1.6 stroke, round caps and joins, no
// fills. Drawn for this app rather than borrowed, so every glyph has the same
// weight and corner language as the type.

export type IconName =
  | 'settings'
  | 'history'
  | 'close'
  | 'swap'
  | 'chevronDown'
  | 'chevronLeft'
  | 'send'
  | 'speaker'
  | 'speakerOff'
  | 'arrowDown'
  | 'plus'
  | 'trash'
  | 'check';

const PATHS: Record<IconName, React.ReactNode> = {
  // Six soft teeth on a ring — calmer than the usual cog.
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.54 5.46l-1.77 1.77M7.23 16.77l-1.77 1.77M18.54 18.54l-1.77-1.77M7.23 7.23L5.46 5.46" />
      <Circle cx="12" cy="12" r="6.75" />
    </>
  ),
  history: (
    <>
      <Path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <Path d="M4.25 4.75v3.5h3.5" />
      <Path d="M12 8.25V12l2.5 1.75" />
    </>
  ),
  close: <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  swap: (
    <>
      <Path d="M4.5 9h14l-3.5-3.5" />
      <Path d="M19.5 15h-14l3.5 3.5" />
    </>
  ),
  chevronDown: <Path d="M7 10l5 5 5-5" />,
  chevronLeft: <Path d="M14.5 6l-6 6 6 6" />,
  send: (
    <>
      <Path d="M12 19V5.5" />
      <Path d="M6.5 11L12 5.5 17.5 11" />
    </>
  ),
  speaker: (
    <>
      <Path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" />
      <Path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
      <Path d="M18.25 6.5a7.8 7.8 0 0 1 0 11" />
    </>
  ),
  speakerOff: (
    <>
      <Path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" />
      <Path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  arrowDown: (
    <>
      <Path d="M12 5v13.5" />
      <Path d="M6.5 13L12 18.5 17.5 13" />
    </>
  ),
  plus: <Path d="M12 5.5v13M5.5 12h13" />,
  trash: (
    <>
      <Path d="M4.5 7h15" />
      <Path d="M9.5 7V4.75h5V7" />
      <Path d="M6.5 7l.9 12.25h9.2L17.5 7" />
    </>
  ),
  check: <Path d="M5.5 12.5l4 4 9-9" />,
};

export function Icon({
  name,
  size = 22,
  color = colors.textMuted,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </Svg>
  );
}
