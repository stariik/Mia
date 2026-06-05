package com.mobile.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Re-schedule alarms after device reboot or app upgrade. Fires
 * `RescheduleAlarmsService` (a HeadlessJsTaskService) which spins up a JS
 * runtime, reads alarms out of AsyncStorage, and reschedules them via
 * Notifee. Without this, all `AlarmManager`-backed triggers are lost on
 * power-cycle.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val accepted = setOf(
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_LOCKED_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON",
      "com.htc.intent.action.QUICKBOOT_POWERON",
    )
    if (action !in accepted) return

    val service = Intent(context, RescheduleAlarmsService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(service)
    } else {
      context.startService(service)
    }
  }
}
