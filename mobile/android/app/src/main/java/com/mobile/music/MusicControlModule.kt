package com.mobile.music

import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.SystemClock
import android.provider.MediaStore
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
 * premium account needed.
 *
 * `playFromSearch` uses Android's documented `MEDIA_PLAY_FROM_SEARCH`
 * intent. Targeting it with `setPackage(...)` routes the search directly to
 * one of the three supported providers; omitting the package lets the OS
 * pick the user's default music app.
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

  @ReactMethod
  fun stop(promise: Promise) {
    try { dispatchKey(KeyEvent.KEYCODE_MEDIA_STOP); promise.resolve(null) }
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

  @ReactMethod
  fun isProviderInstalled(packageName: String, promise: Promise) {
    promise.resolve(isInstalled(packageName))
  }

  private fun isInstalled(packageName: String): Boolean {
    if (packageName.isBlank()) return false
    return try {
      reactApplicationContext.packageManager.getPackageInfo(packageName, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
  }

  @ReactMethod
  fun playFromSearch(query: String, providerPackage: String?, promise: Promise) {
    try {
      if (query.isBlank()) {
        promise.reject("E_BAD_QUERY", "query is empty")
        return
      }
      val intent = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).apply {
        putExtra(SearchManager.QUERY, query)
        putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/audio")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (!providerPackage.isNullOrBlank()) {
        if (!isInstalled(providerPackage)) {
          promise.reject("E_NOT_INSTALLED", "provider not installed: $providerPackage")
          return
        }
        intent.setPackage(providerPackage)
      }
      if (intent.resolveActivity(reactApplicationContext.packageManager) == null) {
        promise.reject("E_NO_HANDLER", "no app can play from search")
        return
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PLAY_SEARCH", e)
    }
  }

  companion object {
    const val NAME = "MusicControlModule"
  }
}
