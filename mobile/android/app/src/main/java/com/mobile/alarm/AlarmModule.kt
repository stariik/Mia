package com.mobile.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.mobile.MainActivity

/**
 * Exposes alarm-tone + notification-channel helpers that Notifee can't do on
 * its own:
 *  - `getDefaultAlarmUri()` returns the system default *alarm* tone URI.
 *  - `createChannels()` registers an "alarms" channel with the system alarm
 *    tone and a strong vibration pattern, plus a "timers" channel with a
 *    softer profile. Notification channels are immutable after creation, so
 *    if we ever need to change the sound/vibration we must bump the IDs.
 */
class AlarmModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * Toggles show-when-locked / turn-screen-on on MainActivity. The AlarmRing
   * screen enables this while ringing (so the alarm stays visible over the
   * keyguard) and disables it on dismiss — the flags MUST NOT stay on during
   * normal use because they break soft-keyboard focus app-wide.
   */
  @ReactMethod
  fun setLockScreenFlags(enabled: Boolean) {
    val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
    activity.runOnUiThread { activity.setLockScreenFlags(enabled) }
  }

  @ReactMethod
  fun getDefaultAlarmUri(promise: Promise) {
    try {
      val uri: Uri? = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      promise.resolve(uri?.toString())
    } catch (e: Exception) {
      promise.reject("E_ALARM_URI", e)
    }
  }

  @ReactMethod
  fun createChannels(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(null)
        return
      }
      val ctx: Context = reactApplicationContext
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

      val alarmUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

      val alarmAttrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

      val alarmChannel = NotificationChannel(
        ALARM_CHANNEL_ID,
        "მაღვიძარა",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Alarm clock notifications"
        setSound(alarmUri, alarmAttrs)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
        setBypassDnd(true)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        enableLights(true)
      }
      nm.createNotificationChannel(alarmChannel)

      val timerChannel = NotificationChannel(
        TIMER_CHANNEL_ID,
        "ტაიმერი",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Timer notifications"
        setSound(alarmUri, alarmAttrs)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 400, 200, 400)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      }
      nm.createNotificationChannel(timerChannel)

      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CHANNEL", e)
    }
  }

  companion object {
    const val NAME = "AlarmModule"
    const val ALARM_CHANNEL_ID = "alarms-v1"
    const val TIMER_CHANNEL_ID = "timers-v1"
  }
}
