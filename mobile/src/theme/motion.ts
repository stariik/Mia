import { Easing } from 'react-native-reanimated';

// Motion is short and decelerating: things arrive and settle, they never
// bounce. Everything that moves checks `useReducedMotion()` (Reanimated) and
// drops to an instant or opacity-only change.
export const duration = {
  fast: 150,
  base: 220,
  slow: 300,
  /** The orb's translator tint and other "mode" changes. */
  mode: 500,
};

export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);
