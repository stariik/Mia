package com.mobile.wake

import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Headless JS task host for a screen-off "Hey Mia" turn.
 *
 * Started by [WakeWordService] when the wake word fires while the app isn't in
 * the foreground. Boots (or reuses) a JS runtime in the background and runs the
 * "MiaWakeTurn" task (index.js → headlessTurn.ts), which records, transcribes,
 * chats, and speaks the reply via native playback — no Activity, screen stays
 * off. The microphone foreground service ([WakeWordService]) stays alive the
 * whole time, which is what keeps background mic access and the CPU awake.
 *
 * Mirrors RescheduleAlarmsService (the existing headless-task pattern).
 */
class WakeTurnService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      "MiaWakeTurn",
      Arguments.createMap(),
      TIMEOUT_MS,
      true, // allowedInForeground — the mic FGS is already running
    )

  override fun onDestroy() {
    // Safety net: the JS turn calls wakeWord.resumeDetection() when it finishes,
    // but if it crashed or timed out, re-arm wake detection here so the listener
    // never gets stuck paused. resume() is idempotent (no-op if already capturing).
    if (WakeWordService.isRunning) {
      Log.i(TAG, "Wake turn finished — re-arming detection.")
      WakeWordService.sendAction(this, WakeWordService.ACTION_RESUME)
    }
    super.onDestroy()
  }

  companion object {
    private const val TAG = "WakeTurnService"
    // A full turn = greeting + up to ~15s listen + STT + chat stream + TTS
    // playback, and the orb path loops for multi-turn. 30s cut that short; the
    // headless task is the JS lifetime cap, so give a turn real room. The mic
    // wake-lock (refreshed each loop via heartbeat) and TURN_WATCHDOG_MS are the
    // independent CPU/​re-arm safety nets.
    private const val TIMEOUT_MS = 120_000L
  }
}
