import { useCallback, useEffect, useRef, useState } from 'react';

import { orbOverlay } from '@/lib/orbOverlay';
import { wakeWord } from '@/lib/wakeWord';

import { ensureMicrophonePermission } from './usePermissions';

/**
 * Re-assert the wake-word service once per app launch if the user left it
 * enabled. This heals the Android 14 gap where a microphone foreground service
 * can't be (re)started from a BOOT_COMPLETED broadcast — opening the app once
 * after a reboot puts "Hey Mia" back. Safe/no-op when unavailable or disabled.
 */
let ensuredThisLaunch = false;
export async function ensureWakeWordOnLaunch(): Promise<void> {
  if (ensuredThisLaunch || !wakeWord.available) return;
  ensuredThisLaunch = true;
  try {
    if (!(await wakeWord.isEnabled())) return;
    await wakeWord.configure();
    if (!(await wakeWord.isRunning())) await wakeWord.start();
  } catch {
    // best-effort
  }
}

/**
 * Route wake detections to `onWake`: both the cold-start flag (app launched by
 * a detection while no JS runtime was alive) and live events (app already up).
 */
export function useWakeTrigger(onWake: () => void): void {
  const ref = useRef(onWake);
  ref.current = onWake;
  useEffect(() => {
    let alive = true;
    wakeWord.consumeInitialWakeTrigger().then((pending) => {
      if (alive && pending) ref.current();
    });
    const unsub = wakeWord.subscribe((e) => {
      if (e.type === 'detected') ref.current();
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);
}

export type WakeToggleResult =
  | { ok: true }
  | { ok: false; reason: 'no-mic' | 'error' };

/** State + actions for the "Hey Mia" switch in Settings. */
export function useWakeWordToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    wakeWord.isEnabled().then((on) => {
      if (alive) setEnabled(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  const set = useCallback(async (next: boolean): Promise<WakeToggleResult> => {
    setBusy(true);
    try {
      if (!next) {
        await wakeWord.stop();
        setEnabled(false);
        return { ok: true };
      }
      const granted = await ensureMicrophonePermission();
      if (!granted) return { ok: false, reason: 'no-mic' };
      await wakeWord.configure();
      const ok = await wakeWord.start();
      setEnabled(ok);
      // Best-effort: ask for "display over other apps" so the floating orb can
      // show during a background turn. Fire-and-forget — if denied, turns just
      // run voice-only. Only prompts the first time (no-op once granted).
      if (ok) orbOverlay.ensurePermission().catch(() => {});
      return ok ? { ok: true } : { ok: false, reason: 'error' };
    } catch {
      return { ok: false, reason: 'error' };
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    enabled,
    busy,
    available: wakeWord.available,
    set,
  };
}
