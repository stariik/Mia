package com.mobile.wake

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * JS bridge for the "Hey Mia" wake word. Thin: it persists config to the same
 * SharedPreferences `WakeWordService` reads, then fires service actions. Config
 * lives in prefs (not just here) so the service survives a process restart /
 * reboot without a live JS runtime.
 *
 * Events are delivered on `WakeWordService.EVENT_NAME` via the device event
 * emitter — `{ type: "detected" | "error" | "started" | "stopped", message? }`.
 */
class WakeWordModule(private val reactCtx: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactCtx) {

  override fun getName(): String = NAME

  private fun prefs() =
    reactCtx.getSharedPreferences(WakeWordService.PREFS, Context.MODE_PRIVATE)

  /**
   * Persist engine config (wake model asset + detection threshold). Restarts
   * the engine if it's already running so changes take effect. openWakeWord
   * needs no account or key — detection is fully local.
   */
  @ReactMethod
  fun configure(modelAsset: String?, threshold: Double, promise: Promise) {
    try {
      prefs().edit()
        .putString(WakeWordService.KEY_KEYWORD_ASSET, modelAsset)
        .putFloat(WakeWordService.KEY_THRESHOLD, threshold.toFloat())
        .apply()
      if (WakeWordService.isRunning) {
        WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_START)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CONFIGURE", e)
    }
  }

  /** Enable + start listening. Must be called while the app is foreground. */
  @ReactMethod
  fun start(promise: Promise) {
    val granted = ContextCompat.checkSelfPermission(
      reactCtx,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED
    if (!granted) {
      promise.reject("E_NO_MIC_PERMISSION", "Microphone permission not granted")
      return
    }
    try {
      prefs().edit().putBoolean(WakeWordService.KEY_ENABLED, true).apply()
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_START)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_START", e)
    }
  }

  /** Disable + tear down the listener. */
  @ReactMethod
  fun stop(promise: Promise) {
    try {
      prefs().edit().putBoolean(WakeWordService.KEY_ENABLED, false).apply()
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_STOP)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_STOP", e)
    }
  }

  /** Release the mic for a foreground recording turn (keeps the service up). */
  @ReactMethod
  fun pause() {
    if (WakeWordService.isRunning) {
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_PAUSE)
    }
  }

  /** Re-acquire the mic after a turn — only if the user still has it enabled. */
  @ReactMethod
  fun resume() {
    if (prefs().getBoolean(WakeWordService.KEY_ENABLED, false)) {
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_RESUME)
    }
  }

  /**
   * Keep a long background turn alive (refresh the wake lock + re-arm watchdog).
   * Called by the JS session each exchange so a continuous conversation isn't
   * cut off by the native 60s safety timers. Fire-and-forget.
   */
  @ReactMethod
  fun heartbeat() {
    if (WakeWordService.isRunning) {
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_HEARTBEAT)
    }
  }

  /**
   * Start recording the user's turn on the shared mic (RECORD mode). The service
   * buffers PCM, streams a throttled `level` event for the orb glow, and emits a
   * final `turnAudio` event when its VAD endpoints. Fire-and-forget — JS waits
   * for the event. This is the app-closed capture path (native, not Picovoice).
   */
  @ReactMethod
  fun startTurnCapture() {
    if (WakeWordService.isRunning) {
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_START_TURN)
    }
  }

  /** Stop an in-progress turn early (e.g. the user tapped the orb). */
  @ReactMethod
  fun stopTurnCapture() {
    if (WakeWordService.isRunning) {
      WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_STOP_TURN)
    }
  }

  @ReactMethod
  fun isEnabled(promise: Promise) {
    promise.resolve(prefs().getBoolean(WakeWordService.KEY_ENABLED, false))
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(WakeWordService.isRunning)
  }

  /**
   * Whether the app was cold-launched by a wake detection (the service's JS
   * event was dropped because no runtime was alive). Read once on mount;
   * consuming it clears the flag.
   */
  @ReactMethod
  fun getInitialWakeTrigger(promise: Promise) {
    val pending = pendingWakeTrigger
    pendingWakeTrigger = false
    promise.resolve(pending)
  }

  // NativeEventEmitter bookkeeping — no-ops, but required or RN logs warnings.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  companion object {
    const val NAME = "WakeWordModule"

    /** Set by MainActivity on a cold wake-launch; read via getInitialWakeTrigger. */
    @Volatile
    @JvmStatic
    var pendingWakeTrigger: Boolean = false

    /** Fire a "detected" event into a live JS runtime (warm wake-launch path). */
    fun emitDetected(reactContext: ReactContext) {
      try {
        val params = Arguments.createMap().apply { putString("type", "detected") }
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(WakeWordService.EVENT_NAME, params)
      } catch (_: Exception) {}
    }
  }
}
