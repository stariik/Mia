import { useCallback, useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';

// Tapping the conversation focuses the text field below it. Done without
// wrapping the list in a Pressable: a parent that claims the touch responder
// can fight the list's scrolling on some Android/iOS versions. Raw touch
// events never claim anything, so the list scrolls exactly as it would alone;
// we just watch for a short, still touch that didn't land on a control and
// didn't stop a scroll.

const MAX_MOVE = 10;
const MAX_MS = 350;
const AFTER_SCROLL_MS = 200;

export function useTapToCompose(onTap: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const onControl = useRef(false);
  const lastScroll = useRef(0);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    start.current = { x: pageX, y: pageY, t: Date.now() };
  }, []);

  const onTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const s = start.current;
      const control = onControl.current;
      start.current = null;
      onControl.current = false;
      if (!s || control) return;
      const { pageX, pageY } = e.nativeEvent;
      const now = Date.now();
      if (
        Math.abs(pageX - s.x) > MAX_MOVE ||
        Math.abs(pageY - s.y) > MAX_MOVE ||
        now - s.t > MAX_MS ||
        now - lastScroll.current < AFTER_SCROLL_MS
      ) {
        return;
      }
      onTap();
    },
    [onTap],
  );

  /** Controls inside the list call this from onPressIn so their taps don't
   *  also focus the text field. */
  const claim = useCallback(() => {
    onControl.current = true;
  }, []);

  /** Call when the user drags or flings the list (not on our own
   *  auto-scroll, which must not swallow taps while a reply streams). */
  const noteScroll = useCallback(() => {
    lastScroll.current = Date.now();
  }, []);

  return { touchProps: { onTouchStart, onTouchEnd }, claim, noteScroll };
}
