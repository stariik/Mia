import { useEffect, useRef, useState } from 'react';

import { safeCut } from '@/lib/textCut';

// Streamed replies arrive in bursts (a clause, then nothing, then three
// words). Painting each burst as it lands makes the text lurch. While a reply
// is live, this lets the visible text catch up to what has arrived at an
// eased, steady pace — fast enough to never fall noticeably behind, smooth
// enough to read as one continuous reveal. It only re-renders the one Text
// that uses it.
//
// It also reports where the "fresh ink" starts: the last few letters written,
// which the row tints warm and lets settle to white a moment later — the
// reply visibly being written, without any motion.

const TICK_MS = 32;
// Fraction of the backlog revealed per tick (plus at least a few letters), so
// a big burst catches up within ~0.3 s while a trickle reads letter by letter.
const CATCH_UP = 0.16;
const MIN_STEP = 2;
// How much text can be "wet" at once, and how fast it dries (letters/tick).
const FRESH_MAX = 28;
const DRY_STEP = 3;

export type Reveal = { text: string; freshFrom: number };

export function useSmoothReveal(text: string, live: boolean): Reveal {
  const [pos, setPos] = useState(() =>
    live ? { shown: 0, dry: 0 } : { shown: text.length, dry: text.length },
  );
  const target = useRef(text.length);
  target.current = text.length;

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      // Returning the same object is a no-op render once caught up and dry.
      setPos((p) => {
        const left = target.current - p.shown;
        const shown =
          left > 0 ? p.shown + Math.max(MIN_STEP, Math.ceil(left * CATCH_UP)) : p.shown;
        const dry = Math.max(Math.min(shown, p.dry + DRY_STEP), shown - FRESH_MAX);
        return shown === p.shown && dry === p.dry ? p : { shown, dry };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  if (!live) return { text, freshFrom: text.length };
  const visible = text.slice(0, safeCut(text, pos.shown));
  return { text: visible, freshFrom: safeCut(visible, pos.dry) };
}
