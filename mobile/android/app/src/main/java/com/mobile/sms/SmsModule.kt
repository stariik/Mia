package com.mobile.sms

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.telephony.SmsManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Voice SMS: read contacts (name + number, matched in JS) and send a text from
 * the user's default SIM. Permissions (READ_CONTACTS / SEND_SMS) are requested
 * from JS before these are called.
 */
class SmsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getContacts(promise: Promise) {
    try {
      val out = Arguments.createArray()
      reactApplicationContext.contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(
          ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
          ContactsContract.CommonDataKinds.Phone.NUMBER,
        ),
        null,
        null,
        null,
      )?.use { c ->
        while (c.moveToNext()) {
          val name = c.getString(0) ?: continue
          val number = c.getString(1) ?: continue
          out.pushMap(Arguments.createMap().apply {
            putString("name", name)
            putString("number", number)
          })
        }
      }
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("E_CONTACTS", e)
    }
  }

  // ponytail: fire-and-forget, no delivery receipt — add a sentIntent if
  // silent carrier failures show up.
  @ReactMethod
  fun send(number: String, text: String, promise: Promise) {
    try {
      val sms =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
          reactApplicationContext.getSystemService(SmsManager::class.java)
        else @Suppress("DEPRECATION") SmsManager.getDefault()
      // Georgian is UCS-2: 70 chars per part, so most messages are multipart.
      sms.sendMultipartTextMessage(number, null, sms.divideMessage(text), null, null)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_SMS_SEND", e)
    }
  }

  /** Fallback without SEND_SMS: open the Messages app prefilled. */
  @ReactMethod
  fun openComposer(number: String, text: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number)))
        .putExtra("sms_body", text)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_SMS_COMPOSER", e)
    }
  }

  companion object {
    const val NAME = "SmsModule"
  }
}
