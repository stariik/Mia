# Play Console — Data Safety form (click-by-click)

I can't submit this for you — it's inside your Play Console behind your Google
login. But every answer below is decided and verified against Mia's code, so
this is pure data entry. Path in Console: **App content → Data safety → Manage → Start**.

Order of the wizard: (1) Overview, (2) Data collection & security, (3) Data
types, (4) per-type detail. Answers:

---

## 1. Overview
- Does your app collect or share any of the required user data types? → **Yes**

## 2. Security practices
- Is all user data encrypted in transit? → **Yes** (network config forces HTTPS)
- Do you provide a way for users to request data deletion? → **Yes**
  - Deletion URL: `https://<your-domain>/delete-account`
- (Optional "committed to Play Families policy") → only if you target children — **leave unchecked** (Mia is not a kids app).

## 3. Which data types are collected
Tick exactly these; leave everything else unticked:

- **Location → Approximate location**
- **Personal info → Email address**
- **Audio → Voice or sound recordings**

> Do NOT tick "Messages", "Files", "Contacts", "Financial", "Health", or any
> analytics/advertising identifiers — Mia has no analytics/ad SDKs, and chat
> text is stored only on-device (Play counts only what leaves the device).

---

## 4. Per-type detail

For every type, Play asks: **Collected or shared? / Processed ephemerally? /
Required or optional? / Purpose(s)?**

### Approximate location
| Field | Answer |
|---|---|
| Collected | **Yes** |
| Shared | **Yes** — sent to the weather provider (Open-Meteo) to fetch local weather |
| Processed ephemerally only | **Yes** (not stored) |
| Required or optional | **Optional** (works without the location permission) |
| Purpose | **App functionality** |

### Email address
| Field | Answer |
|---|---|
| Collected | **Yes** |
| Shared | **No** |
| Processed ephemerally only | **No** (stored for the account) |
| Required or optional | **Required** (account is needed to use the app) |
| Purpose | **Account management** |

### Voice or sound recordings
| Field | Answer |
|---|---|
| Collected | **Yes** |
| Shared | **Yes** — forwarded to speech-recognition providers (Google Cloud) to transcribe |
| Processed ephemerally only | **Yes** — not stored on our servers |
| Required or optional | **Required** (core voice feature) |
| Purpose | **App functionality** |

> If Play asks whether users can request deletion of *this specific* data type:
> for voice, nothing is retained, so there is nothing to delete — but the
> account-deletion path above satisfies the overall requirement.

---

## 5. After the form
- Paste the **privacy policy URL** (`https://<your-domain>/privacy`) in TWO places:
  1. **App content → Privacy policy**
  2. Store listing (some UIs ask again)
- The `/privacy` and `/delete-account` pages are built into `web/` and go live
  automatically when you deploy the backend (blocker #1). Verify both load in a
  browser before you submit.

## 6. One-line notes for the reviewer (App content → other declarations)
If prompted to justify sensitive permissions:
- **Microphone (foreground-service, "Hey Mia")** — "Optional on-device wake word;
  user enables it in Settings. Detection runs locally; no audio is sent until
  the keyword triggers."
- **Full-screen intent / exact alarm** — "Used only for the user's own alarms and
  timers to show the ringing screen."

---

### Before-you-submit checklist
- [ ] `CONTACT_EMAIL` in `web/src/app/privacy/page.tsx` set to the address you want public (currently your Gmail).
- [ ] Backend deployed → `https://<your-domain>/privacy` and `/delete-account` both load.
- [ ] Data Safety form filled per above.
- [ ] Privacy policy URL pasted in App content **and** store listing.
- [ ] (Recommended) Have someone confirm the policy is legally adequate for your entity — I wrote it accurately to the code, but I'm not a lawyer.
