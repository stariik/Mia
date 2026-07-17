package com.mobile.music

import android.content.Context
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Universal music transport control via Android media-button events.
 *
 * `dispatchMediaKeyEvent` is the same mechanism Google Assistant and Bixby
 * use: the foreground audio-session owner (Spotify, Apple Music, Samsung
 * Music, etc.) receives the key event and responds. No SDK, login, or
 * premium account needed. Transport-only by design — the assistant cannot
 * search or launch music.
 */
class MusicControlModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private val audioManager: AudioManager
    get() = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun dispatchKey(keyCode: Int) {
    val now = SystemClock.uptimeMillis()
    audioManager.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
    audioManager.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
  }

  @ReactMethod
  fun pause(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_PAUSE); promise.resolve(null) }
    catch (e: Exception) { promise.reject("E_MEDIA_KEY", e) }
  }

  @ReactMethod
  fun resume(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_PLAY); promise.resolve(null) }
    catch (e: Exception) { promise.reject("E_MEDIA_KEY", e) }
  }

  @ReactMethod
  fun togglePlay(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); promise.resolve(null) }
    catch (e: Exception) { promise.reject("E_MEDIA_KEY", e) }
  }

  @ReactMethod
  fun skipNext(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_NEXT); promise.resolve(null) }
    catch (e: Exception) { promise.reject("E_MEDIA_KEY", e) }
  }

  @ReactMethod
  fun skipPrevious(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS); promise.resolve(null) }
    catch (e: Exception) { promise.reject("E_MEDIA_KEY", e) }
  }

  // No dedicated "restart" media key exists. KEYCODE_MEDIA_PREVIOUS is
  // interpreted by most players (Spotify confirmed) as "back to start of
  // current track if >3s in, otherwise previous track".
  @ReactMethod
  fun restart(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS); promise.resolve(null) }
    catch (e: Exception) { promise.reject("E_MEDIA_KEY", e) }
  }

  companion object {
    const val NAME = "MusicControlModule"
  }
}
