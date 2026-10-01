import { useCallback, useRef, useState } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';

// Smart auto-scroll: new content follows the bottom only while the reader is
// already there. Scrolling up to reread "detaches" — nothing yanks them back
// down; a small "latest" button appears instead. Only the user's own gestures
// can detach: our animated scrolls (whose in-between offsets look "not at
// bottom") never do.

const NEAR_BOTTOM = 72;

type Scrollable = { scrollToEnd(opts?: { animated?: boolean }): void };

export function useStickyScroll<T extends Scrollable>() {
  const ref = useRef<T>(null);
  const attached = useRef(true);
  const userDriven = useRef(false);
  const m = useRef({ offset: 0, content: 0, layout: 0 });
  const [behind, setBehind] = useState(false);

  const measure = useCallback(() => {
    const { offset, content, layout } = m.current;
    return content - (offset + layout) < NEAR_BOTTOM;
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const n = e.nativeEvent;
      m.current = {
        offset: n.contentOffset.y,
        content: n.contentSize.height,
        layout: n.layoutMeasurement.height,
      };
      const near = measure();
      if (near) {
        attached.current = true;
        setBehind(false);
      } else if (userDriven.current) {
        attached.current = false;
      }
    },
    [measure],
  );

  const onScrollBeginDrag = useCallback(() => {
    userDriven.current = true;
  }, []);
  const onMomentumScrollEnd = useCallback(() => {
    userDriven.current = false;
  }, []);
  const onScrollEndDrag = useCallback(() => {
    // Momentum (if any) keeps it user-driven until onMomentumScrollEnd.
    setTimeout(() => {
      userDriven.current = false;
    }, 250);
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const grew = h > m.current.content + 1;
    m.current.content = h;
    if (attached.current) ref.current?.scrollToEnd({ animated: true });
    else if (grew) setBehind(true);
  }, []);

  // The viewport shrinks when the keyboard opens: stay on the latest line.
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    m.current.layout = e.nativeEvent.layout.height;
    if (attached.current) ref.current?.scrollToEnd({ animated: false });
  }, []);

  const jumpToLatest = useCallback(() => {
    attached.current = true;
    setBehind(false);
    ref.current?.scrollToEnd({ animated: true });
  }, []);

  return {
    ref,
    behind,
    jumpToLatest,
    scrollProps: {
      onScroll,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollEnd,
      onContentSizeChange,
      onLayout,
      scrollEventThrottle: 32,
    },
  };
}
