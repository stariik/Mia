package com.mobile.wake

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import kotlin.math.hypot

/**
 * Floating "Hey Mia" orb overlay. Hosts the SAME WebGL orb HTML the in-app orb
 * uses (passed in from JS via `buildOrbHtml`) inside a `TYPE_APPLICATION_OVERLAY`
 * window, so a screen-off / app-closed turn can show the orb floating over
 * whatever's on screen — without launching the app.
 *
 * Only shows when the screen is on AND unlocked: Android does not let a
 * non-system app draw over the secure lock screen, so on a locked/asleep device
 * the turn stays voice-only (the caller falls back to native playback).
 *
 * The orb HTML already posts to `window.ReactNativeWebView.postMessage` (the
 * react-native-webview convention); we satisfy that here with a JS interface of
 * the same name, so its `tts-ended` / `tts-error` / `error` messages reach us
 * unchanged. Driving (`setOrbState`, `setHover`, `playTTSAudio`, `stopTTSAudio`)
 * is the same JS API the in-app orb is driven with — injected via evaluateJavascript.
 */
class OrbOverlayModule(private val reactCtx: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactCtx) {

  override fun getName(): String = NAME

  private var webView: WebView? = null
  private var windowManager: WindowManager? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Resolves on the WebView's `tts-ended`; rejects on `tts-error`. */
  @Volatile private var ttsPromise: Promise? = null

  // ---- permission -----------------------------------------------------------

  @ReactMethod
  fun hasPermission(promise: Promise) {
    promise.resolve(canDrawOverlays())
  }

  /** Open the system "display over other apps" screen. Resolves to the current
   *  grant state (false if the user still needs to grant it). */
  @ReactMethod
  fun requestPermission(promise: Promise) {
    if (canDrawOverlays()) {
      promise.resolve(true)
      return
    }
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + reactCtx.packageName),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactCtx.startActivity(intent)
    } catch (e: Exception) {
      Log.w(TAG, "requestPermission failed", e)
    }
    promise.resolve(false)
  }

  // ---- lifecycle ------------------------------------------------------------

  @ReactMethod
  fun show(html: String, promise: Promise) {
    if (!canDrawOverlays()) {
      Log.i(TAG, "show skipped: 'display over other apps' permission not granted")
      promise.resolve(false)
      return
    }
    if (!screenOnAndUnlocked()) {
      Log.i(TAG, "show skipped: screen off or locked (voice-only by design)")
      promise.resolve(false)
      return
    }
    UiThreadUtil.runOnUiThread {
      try {
        addOverlay(html)
        Log.i(TAG, "overlay shown")
        promise.resolve(true)
      } catch (e: Exception) {
        Log.w(TAG, "show failed", e)
        removeOverlay()
        promise.resolve(false)
      }
    }
  }

  /** Play the orb's exit animation, then remove the view once it has settled. */
  @ReactMethod
  fun hide() {
    UiThreadUtil.runOnUiThread {
      val wv = webView ?: return@runOnUiThread
      inject("window.setOrbVisible && window.setOrbVisible(false)")
      // Remove only after the CSS transition finishes, and only if this same
      // WebView is still up (a new show() in the meantime supersedes it).
      mainHandler.postDelayed({ if (webView === wv) removeOverlay() }, HIDE_ANIM_MS)
    }
  }

  /** Dismiss — used by the orb tap handler and MainActivity.onResume. Runs
   *  natively WITHOUT the JS round-trip (event delivery into the backgrounded
   *  headless runtime lags seconds). Cuts the mic turn + the orb's TTS audio
   *  immediately so the tap feels instant, then plays the exit animation and
   *  drops the window once it settles (same graceful close as hide()). JS still
   *  gets the 'tap' event to finish bookkeeping / re-arm. No-op when nothing is
   *  shown. Posted so it never tears down the view mid-touch. */
  fun closeNow() {
    mainHandler.post {
      val wv = webView ?: return@post
      try {
        WakeWordService.sendAction(reactCtx, WakeWordService.ACTION_STOP_TURN)
      } catch (e: Exception) {
        Log.w(TAG, "stop-turn on close failed", e)
      }
      // Stop audio now, play the exit, then remove only if still the same view.
      inject(
        "window.stopTTSAudio && window.stopTTSAudio();" +
          "window.setOrbVisible && window.setOrbVisible(false)",
      )
      mainHandler.postDelayed({ if (webView === wv) removeOverlay() }, HIDE_ANIM_MS)
    }
  }

  // ---- driving (same JS API as the in-app orb) ------------------------------

  @ReactMethod
  fun setState(name: String) {
    inject("window.setOrbState && window.setOrbState(${JSONObject.quote(name)})")
  }

  @ReactMethod
  fun setLevel(level: Double) {
    inject("window.setHover && window.setHover($level)")
  }

  @ReactMethod
  fun playTts(base64: String, mime: String, promise: Promise) {
    // Supersede any previous pending playback.
    resolveTts()
    if (webView == null) {
      // Overlay already dismissed (tap / app opened) — resolve so the JS
      // playback chain doesn't hang awaiting a tts-ended that never comes.
      promise.resolve(false)
      return
    }
    ttsPromise = promise
    val payload = JSONObject().put("base64", base64).put("mime", mime).toString()
    inject("window.playTTSAudio && window.playTTSAudio($payload)")
  }

  @ReactMethod
  fun stopTts() {
    inject("window.stopTTSAudio && window.stopTTSAudio()")
    resolveTts()
  }

  // ---- internals ------------------------------------------------------------

  @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
  private fun addOverlay(html: String) {
    removeOverlay()
    val wm = reactCtx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val wv = WebView(reactCtx).apply {
      setBackgroundColor(Color.TRANSPARENT)
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      // Let the orb's <audio> autoplay the TTS without a user gesture.
      settings.mediaPlaybackRequiresUserGesture = false
      addJavascriptInterface(Bridge(), "ReactNativeWebView")
      loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
      }

    val density = reactCtx.resources.displayMetrics.density
    val size = (density * OVERLAY_DP).toInt()
    val lp = WindowManager.LayoutParams(
      size,
      size,
      type,
      // Don't steal focus, and let touches OUTSIDE the orb pass through to the
      // app underneath (NOT_TOUCH_MODAL). The orb window itself stays touchable
      // — a tap on it stops listening / dismisses the session (see the touch
      // listener below). HARDWARE_ACCELERATED is required for the WebGL canvas.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = (density * OVERLAY_BOTTOM_MARGIN_DP).toInt()
    }

    // Tap-to-stop: detect a short, low-travel touch on the orb and surface it to
    // JS as a "tap" event (finalize listening, or dismiss the session).
    val slop = density * TAP_SLOP_DP
    var downX = 0f
    var downY = 0f
    var downAt = 0L
    wv.setOnTouchListener { _, ev ->
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = ev.x
          downY = ev.y
          downAt = System.currentTimeMillis()
          true
        }
        MotionEvent.ACTION_UP -> {
          val dt = System.currentTimeMillis() - downAt
          val dist = hypot((ev.x - downX).toDouble(), (ev.y - downY).toDouble())
          if (dt <= TAP_MAX_MS && dist <= slop) {
            closeNow() // dismiss instantly (native) — don't wait for the JS hop
            emitTap() // JS then finishes session teardown / re-arm
          }
          true
        }
        else -> false
      }
    }

    wm.addView(wv, lp)
    windowManager = wm
    webView = wv
    active = this
  }

  private fun removeOverlay() {
    val wv = webView
    webView = null
    active = null
    if (wv != null) {
      try {
        windowManager?.removeView(wv)
      } catch (_: Exception) {}
      try {
        wv.destroy()
      } catch (_: Exception) {}
    }
    windowManager = null
    resolveTts()
  }

  private fun inject(js: String) {
    UiThreadUtil.runOnUiThread {
      try {
        webView?.evaluateJavascript("$js; void 0;", null)
      } catch (e: Exception) {
        Log.w(TAG, "inject failed", e)
      }
    }
  }

  /** Surface an overlay UI event (a tap) to the JS runtime. */
  private fun emitTap() {
    try {
      val params = Arguments.createMap().apply { putString("type", "tap") }
      reactCtx
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, params)
    } catch (e: Exception) {
      Log.w(TAG, "emitTap failed", e)
    }
  }

  private fun resolveTts() {
    val p = ttsPromise ?: return
    ttsPromise = null
    try {
      p.resolve(true)
    } catch (_: Exception) {}
  }

  private fun canDrawOverlays(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactCtx)

  private fun screenOnAndUnlocked(): Boolean =
    try {
      val pm = reactCtx.getSystemService(Context.POWER_SERVICE) as PowerManager
      val km = reactCtx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      pm.isInteractive && !km.isKeyguardLocked
    } catch (e: Exception) {
      false
    }

  /** Receives the orb HTML's `window.ReactNativeWebView.postMessage` payloads. */
  inner class Bridge {
    @JavascriptInterface
    fun postMessage(message: String) {
      try {
        val obj = JSONObject(message)
        when (obj.optString("kind")) {
          "tts-ended", "tts-error" -> resolveTts()
          "error" -> Log.w(TAG, "orb overlay JS error: ${obj.optString("payload")}")
        }
      } catch (e: Exception) {
        Log.w(TAG, "bridge parse failed", e)
      }
    }
  }

  // NativeEventEmitter bookkeeping (no-ops, but keeps RN from warning).
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  companion object {
    const val NAME = "OrbOverlayModule"
    private const val TAG = "OrbOverlay"
    private const val OVERLAY_DP = 150f
    private const val OVERLAY_BOTTOM_MARGIN_DP = 160f

    /** Device event name for overlay UI events (currently just `tap`). */
    const val EVENT_NAME = "OrbOverlayEvent"
    /** Must be ≥ the CSS exit animation (orbExit, 320ms) in buildOrbHtml's
     *  float-in mode, so the window isn't pulled before the close finishes. */
    private const val HIDE_ANIM_MS = 360L
    /** A touch counts as a tap only if it travels less than this and is brief. */
    private const val TAP_SLOP_DP = 16f
    private const val TAP_MAX_MS = 350L

    /** The currently-mounted overlay instance (set while an orb is up), so
     *  MainActivity.onResume can dismiss it natively without a JS round-trip. */
    @Volatile private var active: OrbOverlayModule? = null

    /** Close any visible orb immediately — app opened → Siri-style dismiss. */
    @JvmStatic
    fun dismissActive() {
      active?.closeNow()
    }
  }
}
