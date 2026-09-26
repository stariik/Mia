package com.mobile
import expo.modules.ReactActivityDelegateWrapper

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.mobile.wake.OrbOverlayModule
import com.mobile.wake.WakeWordModule
import com.mobile.wake.WakeWordService
import com.zoontek.rnbootsplash.RNBootSplash

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "mobile"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))

  override fun onCreate(savedInstanceState: Bundle?) {
    // Splash screen — paints the brand-marked launch screen until JS calls
    // BootSplash.hide(). Must be called BEFORE super.onCreate.
    RNBootSplash.init(this, R.style.BootTheme)
    super.onCreate(savedInstanceState)
    // Show-when-locked is only needed when an alarm full-screen intent wakes
    // a locked device. Keeping the flags on permanently breaks IME focus app
    // wide: the keyboard opens then instantly closes and the cursor never
    // blinks. So: enable only if we were actually launched while locked.
    if (isKeyguardLocked()) setLockScreenFlags(true)
    handleWakeIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    // singleTask relaunch (e.g. alarm fires while the app is backgrounded and
    // the device is locked) goes through here, not onCreate.
    if (isKeyguardLocked()) setLockScreenFlags(true)
    handleWakeIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    // Opening the app dismisses the floating "Hey Mia" orb instantly
    // (Siri-style), without waiting for the JS AppState round-trip. No-op when
    // no orb is showing.
    OrbOverlayModule.dismissActive()
  }

  /**
   * The wake-word service launches us via a full-screen-intent notification
   * carrying EXTRA_WAKE. If JS is alive we trigger a turn immediately (warm);
   * if not, we leave a flag the JS layer reads once it mounts (cold start).
   */
  private fun handleWakeIntent(intent: Intent?) {
    if (intent == null || !intent.getBooleanExtra(WakeWordService.EXTRA_WAKE_KEY, false)) return
    intent.removeExtra(WakeWordService.EXTRA_WAKE_KEY) // don't reprocess on resume/rotate
    WakeWordService.cancelTriggerNotification(this)
    val ctx = (application as? MainApplication)?.reactHost?.currentReactContext
    if (ctx != null && ctx.hasActiveReactInstance()) {
      WakeWordModule.emitDetected(ctx)
    } else {
      WakeWordModule.pendingWakeTrigger = true
    }
  }

  private fun isKeyguardLocked(): Boolean {
    val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    return km.isKeyguardLocked
  }

  fun setLockScreenFlags(enabled: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(enabled)
      setTurnScreenOn(enabled)
      if (enabled) {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    } else {
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      if (enabled) window.addFlags(flags) else window.clearFlags(flags)
    }
  }
}
