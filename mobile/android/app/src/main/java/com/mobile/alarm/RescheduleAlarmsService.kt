package com.mobile.alarm

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Headless JS task host. Boots a JS runtime in the background and runs the
 * "RescheduleAlarms" task registered in `index.js`, which re-arms persisted
 * alarms via Notifee.
 */
class RescheduleAlarmsService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    return HeadlessJsTaskConfig(
      "RescheduleAlarms",
      Arguments.createMap(),
      30_000, // 30s budget — reading AsyncStorage + scheduling N triggers is fast
      false,
    )
  }
}
