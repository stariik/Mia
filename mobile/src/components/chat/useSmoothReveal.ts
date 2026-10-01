import { useEffect, useRef, useState } from 'react';

// Streamed replies arrive in bursts (a clause, then nothing, then three
// words). Painting each burst as it lands makes the text lurch. While a reply
// is live, this lets the visible text catch up to what has arrived at an
// eased, steady pace — fast enough to never fall noticeably behind, smooth
// enough to read as one continuous reveal. It only re-renders the one Text
// that uses it.

const TICK_MS = 32;
// Fraction of the backlog revealed per tick (plus at least a few letters), so
// a big burst catches up within ~0.3 s while a trickle reads letter by letter.
const CATCH_UP = 0.16;
const MIN_STEP = 2;

export function useSmoothReveal(text: string, live: boolean): string {
  const [shown, setShown] = useState(() => (live ? 0 : text.length));
  const target = useRef(text.length);
  target.current = text.length;

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      // Returning the same number is a no-op render once caught up.
      setShown((s) => {
        const left = target.current - s;
        if (left <= 0) return s;
        return s + Math.max(MIN_STEP, Math.ceil(left * CATCH_UP));
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  return live ? text.slice(0, Math.min(shown, text.length)) : text;
}
