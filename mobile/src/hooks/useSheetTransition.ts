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

// Opening decelerates hard so the sheet arrives quickly and settles softly;
// closing accelerates away and is shorter, so dismissing never feels sluggish.
const OPEN = { duration: 340, easing: Easing.bezier(0.32, 0.72, 0, 1) };
const CLOSE = { duration: 220, easing: Easing.bezier(0.3, 0, 0.8, 0.15) };

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
  // Until the sheet is measured, start it a full screen down — off-screen
  // either way, so the switch to its real height is never visible.
  const sheetHeight = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = withTiming(1, OPEN);
    } else {
      progress.value = withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      });
    }
  }, [visible, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
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
