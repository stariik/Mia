# Play Console — Data Safety Form

This is the exact checklist to paste into Play Console → App content → Data safety.
Updated to reflect what Mia actually does, based on the codebase.

## Does your app collect or share any of the required user data types?

**Yes**.

## Is all of the user data collected by your app encrypted in transit?

**Yes** — production server uses HTTPS only (see `network_security_config.xml`).

## Do you provide a way for users to request that their data is deleted?

**Yes** — via email (see privacy policy contact line). Mention this on the data-safety form.

---

## Per-data-type declarations

For each, declare: Collected? Shared? Optional? Purpose? Why required?

### Personal info — Name
- **Collected**: Yes
- **Shared**: No (only on our server, not third parties)
- **Optional**: Yes (registration only)
- **Purpose**: Account management, personalisation
- **Required**: No

### Personal info — Email address
- **Collected**: Yes
- **Shared**: No
- **Optional**: No (required for account)
- **Purpose**: Account management
- **Required**: Yes — for sign-in

### Location — Approximate location
- **Collected**: Yes
- **Shared**: Yes — sent to Google Gemini (in chat context), OpenStreetMap (for reverse geocoding), and, when the phone shares no location, the IP address to ipwho.is to estimate the city
- **Optional**: Yes
- **Purpose**: App functionality (weather, time-of-day responses)
- **Required**: No — user can decline the permission; weather then falls back to an IP-based city estimate

### Audio — Voice or sound recordings
- **Collected**: Yes — only while user is actively recording
- **Shared**: Yes — sent to Google Cloud for transcription
- **Optional**: Yes (text input is an alternative)
- **Purpose**: App functionality (speech-to-text)
- **Required**: No — typed input alternative exists
- **NOT stored** — audio is discarded after transcription

### Messages — Other in-app messages
- **Collected**: Yes — conversation history stored locally
- **Shared**: Yes — recent turns sent to Google Gemini as conversation context
- **Optional**: No
- **Purpose**: App functionality (multi-turn conversation)
- **Required**: Yes

### Contacts
- **Collected**: No — READ_CONTACTS is used on-device only to find an SMS recipient; the contact list and numbers are never transmitted (only the chosen name + message text, as part of the chat request)
- **Shared**: No

### Messages — SMS or MMS
- **Collected**: No — SMS is sent from the device after user confirmation; the message text is processed like other chat text (see above)

### App activity — App interactions
- **Collected**: No (no analytics yet)
- **Shared**: No

### Diagnostics — Crash logs / performance data
- **Collected**: No (no crash reporting yet — Sentry is on TODO)
- **Shared**: No

---

## Security practices (questions Play Console asks)

- Data is encrypted in transit (HTTPS): **Yes**
- Data is encrypted at rest: **Partial** — local conversation storage uses AsyncStorage (unencrypted); server-side user data is hashed where appropriate (passwords)
- You follow the Families policy: **N/A** — not a kids app
- You have an independent security review: **No**
- Users can request data be deleted: **Yes** (via email)
- Users can request data not be collected: **Yes** (don't register / decline permissions)

---

## Permissions you'll need to justify

Play Console will ask why each permission is requested. Pre-written answers:

| Permission | Justification |
|---|---|
| `RECORD_AUDIO` | Capturing your voice so Mia can transcribe and respond. |
| `POST_NOTIFICATIONS` | Showing alarm/timer notifications when triggers fire. |
| `ACCESS_COARSE_LOCATION` | Identifying your city so Mia can answer weather questions. |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Triggering alarms at the exact time the user requested. |
| `USE_FULL_SCREEN_INTENT` | Showing the alarm ringing screen over the lock screen when an alarm fires (standard for clock apps). |
| `RECEIVE_BOOT_COMPLETED` | Re-scheduling pending alarms after the device reboots. |
| `WAKE_LOCK` | Keeping the screen on while an alarm is ringing. |
| `DISABLE_KEYGUARD` | Showing the alarm full-screen over the lock screen. |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_SPECIAL_USE` | Running the alarm reschedule service after boot. |
| `VIBRATE` | Haptic feedback for taps and alarm ring. |
| `INTERNET` | Communicating with our server for STT/LLM/TTS. |
