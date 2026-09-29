import { useEffect, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useWindowDimensions } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// The sheet glides up and settles softly, and slips away a little faster so
// dismissing never feels sluggish. The backdrop dims and clears on its own
// gentle curve: sharing the sheet's accelerating close curve kept it dark
// until the very end and then dropped it at once.
const SHEET_OPEN = { duration: 420, easing: Easing.bezier(0.25, 0.8, 0.25, 1) };
const SHEET_CLOSE = { duration: 260, easing: Easing.bezier(0.4, 0, 1, 1) };
const BACKDROP_OPEN = { duration: 320, easing: Easing.out(Easing.quad) };
const BACKDROP_CLOSE = { duration: 240, easing: Easing.out(Easing.quad) };

/**
 * Drives a bottom sheet rendered in an `animationType="none"` Modal: the dim
 * backdrop fades in place while only the sheet slides. RN's built-in "slide"
 * moves the backdrop along with the sheet, which reads as the whole screen
 * lurching. `mounted` keeps the Modal open until the close animation ends.
 */
export function useSheetTransition(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const { height: windowHeight } = useWindowDimensions();
  const progress = useSharedValue(0);
  const dim = useSharedValue(0);
  // Until the sheet is measured, start it a full screen down — off-screen
  // either way, so the switch to its real height is never visible.
  const sheetHeight = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = withTiming(1, SHEET_OPEN);
      dim.value = withTiming(1, BACKDROP_OPEN);
    } else {
      // The backdrop finishes first, so unmounting on the sheet's callback
      // never cuts either short.
      dim.value = withTiming(0, BACKDROP_CLOSE);
      progress.value = withTiming(0, SHEET_CLOSE, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      });
    }
  }, [visible, progress, dim]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (1 - progress.value) * (sheetHeight.value || windowHeight),
      },
    ],
  }));

  const onSheetLayout = (e: LayoutChangeEvent) => {
    sheetHeight.value = e.nativeEvent.layout.height;
  };

  return { mounted, backdropStyle, sheetStyle, onSheetLayout };
}
