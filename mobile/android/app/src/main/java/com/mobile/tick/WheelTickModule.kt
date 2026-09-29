package com.mobile.tick

import android.media.AudioAttributes
import android.media.SoundPool
import android.view.HapticFeedbackConstants
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.mobile.R

/**
 * The click + haptic a scroll wheel gives as each row passes the centre.
 *
 * SoundPool keeps the tiny sample decoded in memory and plays it with almost
 * no latency, never takes audio focus (so the user's music keeps playing) and
 * sends no status events back to JS — unlike a media player, which is far too
 * heavy to fire twenty times a second. The haptic is the system's own
 * CLOCK_TICK, the crisp tick Android uses for its time pickers.
 */
class WheelTickModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private var pool: SoundPool? = null
  private var soundId = 0

  @Synchronized
  private fun ensurePool(): SoundPool {
    pool?.let { return it }
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_GAME)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val created = SoundPool.Builder().setMaxStreams(4).setAudioAttributes(attrs).build()
    soundId = created.load(reactApplicationContext, R.raw.wheel_tick, 1)
    pool = created
    return created
  }

  @ReactMethod
  fun preload() {
    ensurePool()
  }

  @ReactMethod
  fun tick(volume: Double) {
    val p = ensurePool()
    val v = volume.toFloat()
    // Returns 0 (no sound) until the sample has finished loading — harmless.
    p.play(soundId, v, v, 1, 0, 1f)
    UiThreadUtil.runOnUiThread(Runnable {
      reactApplicationContext.currentActivity?.window?.decorView
        ?.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    })
  }

  override fun invalidate() {
    synchronized(this) {
      pool?.release()
      pool = null
    }
    super.invalidate()
  }

  companion object {
    const val NAME = "WheelTick"
  }
}
