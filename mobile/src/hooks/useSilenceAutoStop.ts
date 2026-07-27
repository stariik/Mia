import { useEffect } from 'react';

import { audioLevel } from '@/lib/audioLevel';

// Voice activity detection (VAD) with hysteresis + adaptive noise floor.
//
// The audioLevel SharedValue is dBFS mapped to 0..1 (rmsLevel in pcmCapture,
// written per frame by usePcmRecorder). Anything below -60 dB is clamped to 0
// there, but "background hiss" still surfaces (typically 0.05–0.18 quiet room).
//
// Phases:
//   1. CAL_MS calibration — track loudest ambient sample. Voice-start threshold
//      becomes max(MIN_START, floor × NOISE_FLOOR_MULTIPLIER), clamped.
//   2. Detection with hysteresis — voice "starts" above startThreshold but
//      "continues" while still above continueThreshold (= start × 0.55).
//      This prevents trailing soft syllables from being mistaken for silence.
//   3. Latch — needs MIN_VOICE_LATCH_MS of continuous voice before we mark
//      "user has spoken". Blocks single-sample blips from arming the timer.
//   4. Stop — after SILENCE_MS without continuation level OR after total
//      PRE_SPEECH_GRACE_MS with no speech at all. `onStop` is told which one it
//      was: the caller sends the recording when the user spoke, and treats a
//      silent window as "user is done" (HomeScreen ends the hands-free loop).

const CAL_MS = 400;
const NOISE_FLOOR_MULTIPLIER = 2.2;
const MIN_START_THRESHOLD = 0.32;
const MAX_START_THRESHOLD = 0.55;
const CONTINUE_RATIO = 0.75; // continueThreshold = startThreshold × this
// Continuation also scales to the user's own speech peak: room noise often
// sits near the calibrated floor, so a purely floor-based threshold never
// clears it and the turn never auto-stops. "Still talking" = level at/above
// max(floor-based continue, peak × this).
const CONTINUE_PEAK_RATIO = 0.55;
const CONTINUE_DEBOUNCE_MS = 160; // sustained above-threshold to count as ongoing speech
const MIN_VOICE_LATCH_MS = 200;
const SILENCE_MS = 750;
const PRE_SPEECH_GRACE_MS = 7000;
const POLL_MS = 80;

export function useSilenceAutoStop(
  active: boolean,
  onStop: (spoke: boolean) => void,
) {
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    let noiseFloor = 0;
    let startThreshold = MIN_START_THRESHOLD;
    let continueThreshold = startThreshold * CONTINUE_RATIO;
    let calibrated = false;
    let voiceRunStart = 0; // continuous voice tick chain start; 0 = not in chain
    let lastVoiceAt = 0;
    let hasSpoken = false;
    let stopped = false;
    let peak = 0; // loudest level this turn (for peak-relative silence)

    const stop = (spoke: boolean) => {
      if (stopped) return;
      stopped = true;
      onStop(spoke);
    };

    const id = setInterval(() => {
      if (stopped) return;
      const level = audioLevel.value;
      const now = Date.now();
      const elapsed = now - startedAt;

      // Phase 1: calibrate noise floor.
      if (elapsed < CAL_MS) {
        if (level > noiseFloor) noiseFloor = level;
        return;
      }

      // Lock thresholds once.
      if (!calibrated) {
        calibrated = true;
        startThreshold = Math.min(
          MAX_START_THRESHOLD,
          Math.max(MIN_START_THRESHOLD, noiseFloor * NOISE_FLOOR_MULTIPLIER),
        );
        continueThreshold = startThreshold * CONTINUE_RATIO;
      }

      // Track the loudest sample so the "still talking" threshold scales to
      // how loud THIS user actually speaks (room noise is often near the
      // calibrated floor, so a fixed low threshold never clears it).
      if (level > peak) peak = level;

      // Phase 2: detect with hysteresis. Continuation threshold is the higher
      // of the calibrated floor and a fraction of the speech peak.
      const effContinue = Math.max(
        continueThreshold,
        peak * CONTINUE_PEAK_RATIO,
      );
      const threshold = hasSpoken ? effContinue : startThreshold;

      if (level >= threshold) {
        if (voiceRunStart === 0) voiceRunStart = now;
        const runMs = now - voiceRunStart;
        // Latch: only mark "has spoken" after MIN_VOICE_LATCH_MS continuous.
        if (!hasSpoken && runMs >= MIN_VOICE_LATCH_MS) {
          hasSpoken = true;
        }
        // Only treat as ongoing speech (resetting the silence timer) once the
        // run is sustained — a lone noise spike shouldn't keep recording alive.
        if (!hasSpoken || runMs >= CONTINUE_DEBOUNCE_MS) {
          lastVoiceAt = now;
        }
        return;
      }

      // Drop below threshold → break the run.
      voiceRunStart = 0;

      if (!hasSpoken) {
        if (elapsed > PRE_SPEECH_GRACE_MS) stop(false);
        return;
      }

      if (now - lastVoiceAt > SILENCE_MS) stop(true);
    }, POLL_MS);

    return () => clearInterval(id);
  }, [active, onStop]);
}
