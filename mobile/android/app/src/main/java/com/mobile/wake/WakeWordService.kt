package com.mobile.wake

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.mobile.MainActivity
import com.mobile.MainApplication
import com.mobile.R
import java.io.ByteArrayOutputStream
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Always-on "Hey Mia" wake-word listener.
 *
 * Runs the openWakeWord engine ([OwwEngine]) inside a microphone-type
 * foreground service so it keeps listening after the app UI is closed — a JS
 * detector can't do this because it dies with the JS runtime. Detection is
 * fully on-device; no audio leaves the phone until the keyword fires.
 *
 * Unlike Porcupine (which owned the mic for us), openWakeWord just scores audio
 * frames, so we run our own [AudioRecord] capture thread and feed it 80 ms
 * chunks. The engine (ONNX sessions) lives for the service's lifetime; only the
 * AudioRecord is acquired/released around pause/resume so the in-app recorder
 * can own the mic for a turn without two consumers fighting.
 *
 * Lifecycle is action-driven (see companion ACTION_*):
 *   START   — (re)build the engine from SharedPreferences config and listen.
 *   PAUSE   — release the mic but stay foreground (engine kept warm).
 *   RESUME  — reset engine state + re-acquire the mic after a pause.
 *   STOP    — tear everything down and leave the foreground.
 *
 * On detection we (1) emit a JS event for an instant, tap-free start when the
 * app is alive, and (2) post a full-screen-intent notification — the
 * BAL-compliant way to bring the Activity to the front from the background,
 * the same mechanism the alarm uses.
 *
 * Config is read from SharedPreferences (not the JS bridge) so the service
 * survives a START_STICKY restart and a reboot without a live JS runtime.
 */
class WakeWordService : Service() {
  private var engine: OwwEngine? = null
  private var captureThread: Thread? = null
  @Volatile private var capturing = false
  private var listening = false

  // RECORD-mode (the user's turn) capture. Shares the same mic as the DETECT
  // loop above — only one runs at a time; never two AudioRecords on one mic.
  private var turnThread: Thread? = null
  @Volatile private var turnRecording = false
  // Ends a smart-start capture early (orb tapped). See [earlyCapture].
  @Volatile private var earlyAbort = false

  // Transient "may duck" audio focus held while Mia listens, so music drops in
  // volume and the user is heard over it. See [duckMusic].
  private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
  private val focusListener = AudioManager.OnAudioFocusChangeListener { }
  private var focusRequest: AudioFocusRequest? = null
  @Volatile private var ducking = false

  // Held during a background (screen-off) turn so STT/chat/TTS run with the CPU
  // awake; released when the turn re-arms detection.
  private var turnWakeLock: PowerManager.WakeLock? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  // Safety net: if a background turn never re-arms detection (JS died mid-turn),
  // re-arm anyway so the next "Mia" still works.
  private val resumeWatchdog = Runnable {
    if (isRunning && !capturing) {
      Log.w(TAG, "Background-turn watchdog fired — re-arming detection.")
      releaseTurnWakeLock()
      restoreMusic()
      engine?.reset()
      startCapture()
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannels()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A null intent means the OS restarted us (START_STICKY) — resume listening.
    when (intent?.action ?: ACTION_START) {
      ACTION_PAUSE -> pause()
      ACTION_RESUME -> resume()
      ACTION_HEARTBEAT -> heartbeat()
      ACTION_START_TURN -> startTurnCapture()
      ACTION_STOP_TURN -> stopTurnCapture()
      ACTION_STOP -> {
        stopListening()
        stopForegroundCompat()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> buildAndStart()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    teardownManager()
    isRunning = false
    super.onDestroy()
  }

  // ---- engine control -------------------------------------------------------

  private fun buildAndStart() {
    // Assert the foreground notification FIRST so we satisfy the 5s
    // startForegroundService deadline even on a config error or a restart.
    startForegroundCompat()
    // Fresh engine every START so config changes (model/threshold) take effect.
    teardownManager()

    if (!hasMicPermission()) {
      Log.w(TAG, "RECORD_AUDIO not granted — cannot start wake word.")
      emit("error", "missing-mic-permission")
      stopForegroundCompat()
      stopSelf()
      return
    }

    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val configured = prefs.getString(KEY_KEYWORD_ASSET, MIA_MODEL_ASSET) ?: MIA_MODEL_ASSET
    // Use the custom "Mia" model if bundled, else the pretrained fallback so the
    // whole pipeline is testable before the custom model is trained.
    val wakeAsset = if (assetExists(configured)) configured else FALLBACK_MODEL_ASSET
    if (wakeAsset != configured) {
      Log.w(TAG, "Wake model '$configured' missing; using fallback '$FALLBACK_MODEL_ASSET'.")
    }
    val threshold = prefs.getFloat(KEY_THRESHOLD, DEFAULT_THRESHOLD)
    val trigger = prefs.getInt(KEY_TRIGGER, DEFAULT_TRIGGER)

    try {
      engine = OwwEngine(applicationContext, wakeAsset, threshold, trigger)
      startCapture()
      isRunning = true
      emit("started", null)
      Log.i(TAG, "Wake-word listening started (model=$wakeAsset, threshold=$threshold).")
    } catch (e: Exception) {
      Log.e(TAG, "Failed to initialise openWakeWord engine", e)
      emit("error", e.message ?: "init-failed")
      teardownManager()
      stopForegroundCompat()
      stopSelf()
    }
  }

  private fun pause() {
    // Release the mic but keep the engine + foreground notification so RESUME
    // is cheap. Used while the in-app recorder owns the mic for a turn.
    duckMusic()
    stopTurnCapture()
    stopCapture()
    listening = false
  }

  private fun resume() {
    // A turn (foreground or background) just finished — drop its wake lock and
    // cancel the re-arm watchdog.
    mainHandler.removeCallbacks(resumeWatchdog)
    releaseTurnWakeLock()
    restoreMusic()
    startForegroundCompat()
    val eng = engine
    if (eng == null) {
      buildAndStart()
      return
    }
    // A turn cancelled mid smart-start may still be on the detection thread;
    // startCapture() would see `capturing` and leave the mic dead.
    if (earlyTurnState == EARLY_PENDING) stopCapture()
    // Drop any stale buffered audio so it can't self-fire right after resume.
    eng.reset()
    startCapture()
    isRunning = true
  }

  /**
   * Keep a long background turn alive. A continuous conversation can outlast the
   * 60s turn wake-lock + re-arm watchdog set in [startBackgroundTurn]; the JS
   * session calls this each exchange to refresh the lock and push the watchdog
   * out, so detection isn't force-re-armed (yanking the mic) mid-conversation.
   * No-op when no turn is in flight (the wake lock is the turn marker).
   */
  private fun heartbeat() {
    val wl = turnWakeLock ?: return
    try {
      // acquire(timeout) on a held, non-reference-counted lock resets its timer.
      if (wl.isHeld) wl.acquire(WAKE_LOCK_TIMEOUT_MS)
    } catch (e: Exception) {
      Log.w(TAG, "heartbeat wakelock failed", e)
    }
    mainHandler.removeCallbacks(resumeWatchdog)
    mainHandler.postDelayed(resumeWatchdog, TURN_WATCHDOG_MS)
  }

  private fun stopListening() {
    teardownManager()
    isRunning = false
    emit("stopped", null)
  }

  private fun teardownManager() {
    mainHandler.removeCallbacks(resumeWatchdog)
    releaseTurnWakeLock()
    restoreMusic()
    stopTurnCapture()
    stopCapture()
    try {
      engine?.close()
    } catch (_: Exception) {}
    engine = null
    listening = false
  }

  // ---- audio capture --------------------------------------------------------

  private fun startCapture() {
    if (capturing) return
    // Never run DETECT + a RECORD turn on the mic at once.
    stopTurnCapture()
    val eng = engine ?: return
    capturing = true
    captureThread = Thread { captureLoop(eng) }.apply {
      name = "oww-capture"
      start()
    }
    listening = true
  }

  private fun stopCapture() {
    capturing = false
    captureThread?.let { t ->
      try {
        t.join(1500)
      } catch (_: InterruptedException) {}
    }
    captureThread = null
  }

  /**
   * Read 16 kHz PCM16 mono and feed it to the engine until [capturing] clears.
   * VOICE_RECOGNITION keeps OEM signal processing minimal, which suits a
   * keyword spotter. Runs on its own thread (never the main/JS thread).
   */
  private fun captureLoop(eng: OwwEngine) {
    val record = openRecord() ?: run {
      capturing = false
      return
    }

    val buf = ShortArray(CHUNK_SHORTS)
    // Smart start: the last ~1.1 s of audio (so a command said in the same
    // breath as "Mia" keeps its start despite detection lag) and ~3 s of levels
    // (this room's noise floor). See [earlyCapture].
    val preRoll = ArrayDeque<ShortArray>()
    val levels = ArrayDeque<Float>()
    // Set when a background detection ran a smart start; its result is published
    // only after `finally` has released the mic.
    var earlyTurn = false
    try {
      record.startRecording()
      while (capturing) {
        val n = record.read(buf, 0, buf.size)
        if (n <= 0) {
          if (n == AudioRecord.ERROR_INVALID_OPERATION || n == AudioRecord.ERROR_BAD_VALUE) break
          continue
        }
        preRoll.addLast(buf.copyOf(n))
        if (preRoll.size > PREROLL_CHUNKS) preRoll.removeFirst()
        levels.addLast(chunkLevel(buf, n))
        if (levels.size > FLOOR_CHUNKS) levels.removeFirst()
        val fired = try {
          eng.process(buf, n)
        } catch (e: Exception) {
          Log.e(TAG, "Inference failed", e)
          emit("error", e.message ?: "inference-failed")
          break
        }
        if (fired && capturing) {
          // Lower the music the moment "Mia" is heard, as Google Assistant does.
          duckMusic()
          if (isAppInForeground()) {
            // App visible: the live JS UI runs the turn through the orb (the
            // event starts listening with no tap, same path as tapping the orb).
            // Keep looping — JS calls pauseDetection to take the mic; refractory
            // suppresses a re-fire until then.
            Log.i(TAG, "Wake word detected (foreground).")
            emit("detected", null)
          } else {
            // App backgrounded/closed: run the turn headless (screen stays off).
            // No emit (so a backgrounded JS UI doesn't also start a turn); no
            // launch notification. JS boots while we keep listening on this
            // same mic, then collects the smart-start result.
            Log.i(TAG, "Wake word detected (background).")
            earlyTurnAudio = null
            earlyTurnState = EARLY_PENDING
            if (startBackgroundTurn()) {
              earlyTurn = true
              earlyTurnAudio = earlyCapture(record, buf, preRoll, levels)
              capturing = false
            } else {
              earlyTurnState = EARLY_NONE
              eng.reset() // no turn: keep listening for the next "Mia"
            }
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "captureLoop error", e)
    } finally {
      try {
        record.stop()
      } catch (_: Exception) {}
      record.release()
    }
    // Mic is fully released now — safe for JS to open the turn recorder.
    if (earlyTurn) {
      earlyTurnState = EARLY_DONE
      emit("earlyTurn", null)
    }
  }

  /**
   * Smart start. Keep recording on the detection mic and decide whether the
   * user kept talking after "Mia" ("Mia, pause" in one breath). Returns base64
   * PCM16 including the pre-roll, or null when they stopped after "Mia" — JS
   * then greets and records as usual. Speech counts if it is already under way
   * at the detection frame (detection lags the end of "Mia" by a few frames)
   * or starts within [EARLY_GRACE_MS]. Ends early when [capturing] clears
   * (pause/stop) or [earlyAbort] is set (orb tapped).
   */
  private fun earlyCapture(
    record: AudioRecord,
    buf: ShortArray,
    preRoll: ArrayDeque<ShortArray>,
    levels: ArrayDeque<Float>,
  ): String? {
    earlyAbort = false
    val pcm = ByteArrayOutputStream()
    for (chunk in preRoll) writePcm(pcm, chunk, chunk.size)
    val sorted = levels.sorted()
    val floor = if (sorted.isEmpty()) 0f else sorted[sorted.size / 5]
    val startLevel = (floor * TURN_NOISE_FLOOR_MULTIPLIER)
      .coerceIn(TURN_MIN_START_LEVEL, TURN_MAX_START_LEVEL)
    val detectMs = SystemClock.elapsedRealtime()
    val ongoing = (levels.lastOrNull() ?: 0f) >= startLevel
    var voiceRunStart = if (ongoing) detectMs - CHUNK_MS else 0L
    var speechStarted = false
    var lastSpeechMs = detectMs
    var peak = 0f
    var lastLevelEmit = 0L
    while (capturing && !earlyAbort) {
      val n = record.read(buf, 0, buf.size)
      if (n <= 0) {
        if (n == AudioRecord.ERROR_INVALID_OPERATION || n == AudioRecord.ERROR_BAD_VALUE) break
        continue
      }
      writePcm(pcm, buf, n)
      val level = chunkLevel(buf, n)
      val now = SystemClock.elapsedRealtime()
      if (now - lastLevelEmit >= LEVEL_EMIT_INTERVAL_MS) {
        emitLevel(level)
        lastLevelEmit = now
      }
      val elapsed = now - detectMs
      // Short cap: over loud music the level may never drop to "silence".
      if (elapsed > EARLY_MAX_RECORD_MS) break
      if (level > peak) peak = level
      val continueLevel =
        max(startLevel * TURN_CONTINUE_RATIO, peak * TURN_CONTINUE_PEAK_RATIO)
      val threshold = if (speechStarted) continueLevel else startLevel
      if (level >= threshold) {
        if (voiceRunStart == 0L) voiceRunStart = now
        val runMs = now - voiceRunStart
        if (!speechStarted && runMs >= TURN_VOICE_LATCH_MS) speechStarted = true
        if (!speechStarted || runMs >= TURN_CONTINUE_DEBOUNCE_MS) lastSpeechMs = now
        continue
      }
      voiceRunStart = 0L
      if (!speechStarted) {
        if (elapsed > EARLY_GRACE_MS) break
        continue
      }
      if (now - lastSpeechMs > TURN_SILENCE_MS) break
    }
    Log.i(
      TAG,
      "[early] floor=$floor start=$startLevel ongoing=$ongoing speech=$speechStarted " +
        "peak=$peak ms=${SystemClock.elapsedRealtime() - detectMs}",
    )
    return if (speechStarted) Base64.encodeToString(pcm.toByteArray(), Base64.NO_WRAP) else null
  }

  /**
   * Lower whatever is playing while Mia listens and answers: transient
   * "may duck" focus makes music apps (or the system, on their behalf) drop to a
   * low volume rather than stop. Media keys still reach the music app, since
   * this creates no media session. Idempotent; undone by [restoreMusic].
   */
  // Called from the capture thread (detection) and the main thread (pause).
  @Synchronized
  private fun duckMusic() {
    if (ducking) return
    ducking = true
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(
            // No CONTENT_TYPE_SPEECH: that can make the system pause other apps
            // instead of ducking them.
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).build(),
          )
          .setOnAudioFocusChangeListener(focusListener, mainHandler)
          .build()
        focusRequest = request
        audioManager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(
          focusListener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
        )
      }
    } catch (e: Exception) {
      Log.w(TAG, "duck request failed", e)
    }
  }

  /** Give focus back so ducked music returns to full volume. Idempotent. */
  @Synchronized
  private fun restoreMusic() {
    if (!ducking) return
    ducking = false
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
      } else {
        @Suppress("DEPRECATION")
        audioManager.abandonAudioFocus(focusListener)
      }
    } catch (e: Exception) {
      Log.w(TAG, "duck release failed", e)
    }
  }

  private fun writePcm(out: ByteArrayOutputStream, samples: ShortArray, n: Int) {
    val bytes = ByteArray(n * 2)
    for (i in 0 until n) {
      val v = samples[i].toInt()
      bytes[i * 2] = (v and 0xFF).toByte()
      bytes[i * 2 + 1] = ((v shr 8) and 0xFF).toByte()
    }
    out.write(bytes, 0, bytes.size)
  }

  /** Open the shared mic AudioRecord (16 kHz PCM16 mono, VOICE_RECOGNITION).
   *  Returns null (after emitting an error) when the mic can't be acquired. */
  private fun openRecord(): AudioRecord? {
    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minBuf <= 0) {
      emit("error", "audiorecord-unsupported")
      return null
    }
    val bufSize = max(minBuf, CHUNK_SHORTS * 2 * 4)
    val record = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize,
      )
    } catch (e: Exception) {
      Log.e(TAG, "AudioRecord init failed", e)
      emit("error", "audiorecord-init-failed")
      return null
    }
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      Log.e(TAG, "AudioRecord not initialised (mic busy or no permission).")
      emit("error", "audiorecord-uninitialised")
      record.release()
      return null
    }
    return record
  }

  // ---- turn capture (the user's spoken turn, RECORD mode) -------------------

  /**
   * Record one user turn on the shared mic. The JS background session calls this
   * (via [WakeWordModule.startTurnCapture]) after the greeting; we buffer PCM16,
   * push a throttled audio level to JS for the orb glow, and end the turn with
   * energy-based VAD (initial-speech grace → trailing-silence stop → max cap),
   * then emit the final base64 audio. This is the native-capture path that
   * replaces the foreground-only Picovoice recorder, which hung when the app was
   * closed — see mobile/docs/hey-jarvis-rebuild-prompt.md §2.
   */
  private fun startTurnCapture() {
    if (turnRecording) return
    stopCapture() // DETECT loop must release the mic first.
    if (!hasMicPermission()) {
      emitTurnAudio(null, SAMPLE_RATE)
      return
    }
    // Hold the CPU + push the re-arm watchdog out while we record.
    acquireTurnWakeLock()
    mainHandler.removeCallbacks(resumeWatchdog)
    mainHandler.postDelayed(resumeWatchdog, TURN_WATCHDOG_MS)
    turnRecording = true
    turnThread = Thread { turnCaptureLoop() }.apply {
      name = "mia-turn"
      start()
    }
  }

  private fun stopTurnCapture() {
    earlyAbort = true
    turnRecording = false
    turnThread?.let { t ->
      try {
        t.join(1500)
      } catch (_: InterruptedException) {}
    }
    turnThread = null
  }

  private fun turnCaptureLoop() {
    // Settle the audio route after TTS before grabbing the mic (see
    // TURN_SETTLE_MS). On the turn thread, so it's unaffected by JS timer pause.
    try {
      Thread.sleep(TURN_SETTLE_MS)
    } catch (_: InterruptedException) {}
    val record = openRecord() ?: run {
      turnRecording = false
      turnThread = null
      emitTurnAudio(null, SAMPLE_RATE)
      return
    }
    val buf = ShortArray(CHUNK_SHORTS)
    val byteChunk = ByteArray(CHUNK_SHORTS * 2)
    // ponytail: whole capture buffered in RAM then base64'd over the bridge.
    // Bounded to ~MAX_RECORD_MS by the VAD (~480 KB), fine; if it ever grows,
    // hand off a file path instead of a base64 string.
    val pcm = ByteArrayOutputStream()
    val startMs = SystemClock.elapsedRealtime()
    var lastSpeechMs = startMs
    var lastLevelEmit = 0L
    var speechStarted = false
    // VAD state — mirrors useSilenceAutoStop.ts phase for phase.
    var noiseFloor = 0f
    var startLevel = TURN_MIN_START_LEVEL
    var calibrated = false
    var peak = 0f
    var voiceRunStart = 0L // start of the current above-threshold run; 0 = none
    try {
      record.startRecording()
      Log.i(TAG, "recorder started (turn)")
      while (turnRecording) {
        val n = record.read(buf, 0, buf.size)
        if (n <= 0) {
          if (n == AudioRecord.ERROR_INVALID_OPERATION || n == AudioRecord.ERROR_BAD_VALUE) break
          continue
        }
        // PCM16 little-endian (the server trims leading/trailing silence, so we
        // keep the whole capture rather than trimming the pre-speech grace here).
        for (i in 0 until n) {
          val s = buf[i].toInt()
          byteChunk[i * 2] = (s and 0xFF).toByte()
          byteChunk[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        pcm.write(byteChunk, 0, n * 2)

        val level = chunkLevel(buf, n)
        val now = SystemClock.elapsedRealtime()
        if (now - lastLevelEmit >= LEVEL_EMIT_INTERVAL_MS) {
          emitLevel(level)
          lastLevelEmit = now
        }
        val elapsed = now - startMs

        // Checked first so a user who never pauses is still capped (the buffer
        // is held in RAM); everything below can skip the rest of the tick.
        if (elapsed > TURN_MAX_RECORD_MS) {
          Log.i(TAG, "[vad] max duration — stopping turn"); break
        }

        // Phase 1: learn this room's noise floor before judging anything.
        if (elapsed < TURN_CAL_MS) {
          if (level > noiseFloor) noiseFloor = level
          continue
        }
        // Phase 2: lock the speech-start bar once, from that floor.
        if (!calibrated) {
          calibrated = true
          startLevel = (noiseFloor * TURN_NOISE_FLOOR_MULTIPLIER)
            .coerceIn(TURN_MIN_START_LEVEL, TURN_MAX_START_LEVEL)
          Log.i(TAG, "[vad] calibrated floor=$noiseFloor start=$startLevel")
        }

        if (level > peak) peak = level

        // Phase 3: hysteresis. Once speech has latched, "still talking" uses a
        // LOWER bar than "started talking", and that bar scales to how loud this
        // user actually is — the old fixed bar cut people off as they trailed off.
        val continueLevel =
          max(startLevel * TURN_CONTINUE_RATIO, peak * TURN_CONTINUE_PEAK_RATIO)
        val threshold = if (speechStarted) continueLevel else startLevel

        if (level >= threshold) {
          if (voiceRunStart == 0L) voiceRunStart = now
          val runMs = now - voiceRunStart
          // Latch: a lone spike (cough, door) must not arm the turn.
          if (!speechStarted && runMs >= TURN_VOICE_LATCH_MS) speechStarted = true
          // Only a sustained run resets the silence timer.
          if (!speechStarted || runMs >= TURN_CONTINUE_DEBOUNCE_MS) lastSpeechMs = now
          continue
        }

        // Phase 4: below threshold — the run is broken.
        voiceRunStart = 0L
        if (!speechStarted) {
          if (elapsed > TURN_PRE_SPEECH_GRACE_MS) {
            Log.i(TAG, "[vad] no speech — stopping turn (start=$startLevel)"); break
          }
          continue
        }
        if (now - lastSpeechMs > TURN_SILENCE_MS) {
          Log.i(
            TAG,
            "[vad] trailing silence — stopping turn " +
              "(start=$startLevel peak=$peak last=$level)",
          )
          break
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "turnCaptureLoop error", e)
    } finally {
      try {
        record.stop()
      } catch (_: Exception) {}
      record.release()
    }
    turnRecording = false
    turnThread = null
    // No speech at all → null so JS ends the session (silence == goodbye).
    val audio = if (speechStarted) Base64.encodeToString(pcm.toByteArray(), Base64.NO_WRAP) else null
    emitTurnAudio(audio, SAMPLE_RATE)
  }

  /** Mic-frame amplitude in 0..1 on a dBFS curve — matches the JS `rmsLevel`
   *  the in-app orb uses, so the overlay orb reacts to the voice identically. */
  private fun chunkLevel(buf: ShortArray, n: Int): Float {
    var sum = 0.0
    for (i in 0 until n) {
      val v = buf[i] / 32768.0
      sum += v * v
    }
    val rms = sqrt(sum / n)
    if (rms < 1e-6) return 0f
    val db = (20.0 * log10(rms)).coerceIn(-60.0, 0.0)
    return ((db + 60.0) / 60.0).toFloat()
  }

  private fun hasMicPermission(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  /**
   * Run a screen-off answer turn. Called from the capture thread AFTER it has
   * released the AudioRecord, so the in-turn recorder can own the mic.
   *
   * Always via the headless JS task (WakeTurnService → "MiaWakeTurn"), which
   * reuses the live JS runtime when the mic FGS has kept it warm, or boots one
   * when cold. The headless task is what keeps RN's JS timers (setTimeout /
   * Promise scheduling) ticking while no Activity is resumed — emitting a "turn"
   * straight into the backgrounded runtime instead left timers PAUSED, so the
   * turn stalled at its first setTimeout (the settle, then the answer pacing)
   * until the app was foregrounded. NO Activity launch and NO extra
   * notification; a wake lock holds the CPU through STT/chat/TTS and detection
   * re-arms when the turn finishes.
   */
  private fun startBackgroundTurn(): Boolean {
    // Called on the capture thread, which keeps the mic for the smart start.
    // captureThread stays set so pause()/startTurnCapture() still join it
    // before anyone else opens the mic.
    acquireTurnWakeLock()
    mainHandler.removeCallbacks(resumeWatchdog)
    mainHandler.postDelayed(resumeWatchdog, TURN_WATCHDOG_MS)

    Log.i(TAG, "Starting background turn (headless task; live JS reused if warm).")
    return try {
      startService(Intent(this, WakeTurnService::class.java))
      true
    } catch (e: Exception) {
      Log.w(TAG, "Headless turn start failed; staying in detection", e)
      mainHandler.removeCallbacks(resumeWatchdog)
      releaseTurnWakeLock()
      false
    }
  }

  private fun acquireTurnWakeLock() {
    try {
      if (turnWakeLock?.isHeld == true) return
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      turnWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_TIMEOUT_MS)
      }
    } catch (e: Exception) {
      Log.w(TAG, "acquireTurnWakeLock failed", e)
    }
  }

  private fun releaseTurnWakeLock() {
    try {
      if (turnWakeLock?.isHeld == true) turnWakeLock?.release()
    } catch (e: Exception) {
      Log.w(TAG, "releaseTurnWakeLock failed", e)
    }
    turnWakeLock = null
  }

  /** True only when the activity is actually RESUMED (visible foreground). */
  private fun isAppInForeground(): Boolean =
    try {
      val app = applicationContext as? MainApplication
      val ctx = app?.reactHost?.currentReactContext
      ctx != null && ctx.hasActiveReactInstance() &&
        ctx.lifecycleState == LifecycleState.RESUMED
    } catch (e: Exception) {
      false
    }

  // ---- JS bridge ------------------------------------------------------------

  private fun emitEvent(params: WritableMap) {
    try {
      val app = applicationContext as? MainApplication ?: return
      val reactContext: ReactContext = app.reactHost.currentReactContext ?: return
      if (!reactContext.hasActiveReactInstance()) return
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, params)
    } catch (e: Exception) {
      Log.w(TAG, "emitEvent failed", e)
    }
  }

  private fun emit(type: String, message: String?) {
    emitEvent(Arguments.createMap().apply {
      putString("type", type)
      if (message != null) putString("message", message)
    })
  }

  /** Throttled mic level (0..1) during a turn — drives the orb's listening glow. */
  private fun emitLevel(level: Float) {
    emitEvent(Arguments.createMap().apply {
      putString("type", "level")
      putDouble("level", level.toDouble())
    })
  }

  /** Final captured turn: base64 PCM16 (null = the user said nothing). */
  private fun emitTurnAudio(audioBase64: String?, sampleRate: Int) {
    emitEvent(Arguments.createMap().apply {
      putString("type", "turnAudio")
      if (audioBase64 != null) putString("audioBase64", audioBase64) else putNull("audioBase64")
      putInt("sampleRate", sampleRate)
    })
  }

  // ---- notifications --------------------------------------------------------

  private fun createChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(
      NotificationChannel(
        CHANNEL_LISTENING,
        "Hey Mia",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shown while Mia is listening for the wake word"
        setShowBadge(false)
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(
        CHANNEL_TRIGGER,
        "Mia activation",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Brings Mia to the foreground when the wake word is heard"
        setShowBadge(false)
      },
    )
  }

  private fun buildOngoingNotification(): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val contentPi = PendingIntent.getActivity(this, 0, openIntent, pendingFlags())
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_LISTENING)
      } else {
        @Suppress("DEPRECATION") Notification.Builder(this)
      }
    return builder
      .setContentTitle("Mia")
      .setContentText("Listening for “Mia”")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setContentIntent(contentPi)
      .build()
  }

  private fun postWakeLaunchNotification() {
    val intent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_WAKE_KEY, true)
    }
    val pi = PendingIntent.getActivity(this, 1, intent, pendingFlags())
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_TRIGGER)
      } else {
        @Suppress("DEPRECATION") Notification.Builder(this)
      }
    val notif = builder
      .setContentTitle("Mia")
      .setContentText("გისმენ…") // "I'm listening…"
      .setSmallIcon(R.mipmap.ic_launcher)
      // CATEGORY_CALL maximises full-screen-intent eligibility (assistant
      // "incoming" UI). On Android 14 a non-call/alarm app may have its FSI
      // downgraded to a heads-up notification — then the user taps to open.
      .setCategory(Notification.CATEGORY_CALL)
      .setContentIntent(pi)
      .setFullScreenIntent(pi, true)
      .setAutoCancel(true)
      .setTimeoutAfter(8000)
      .build()
    try {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(NOTIF_TRIGGER, notif)
    } catch (e: Exception) {
      Log.w(TAG, "postWakeLaunchNotification failed", e)
    }
  }

  private fun startForegroundCompat() {
    val notif = buildOngoingNotification()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIF_ONGOING, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIF_ONGOING, notif)
      }
    } catch (e: Exception) {
      // e.g. ForegroundServiceStartNotAllowedException when something tried to
      // start us from the background on Android 12+. The app re-ensures the
      // service the next time it's opened in the foreground.
      Log.w(TAG, "startForeground failed", e)
    }
  }

  private fun stopForegroundCompat() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION") stopForeground(true)
      }
    } catch (e: Exception) {
      Log.w(TAG, "stopForeground failed", e)
    }
  }

  private fun pendingFlags(): Int {
    var f = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      f = f or PendingIntent.FLAG_IMMUTABLE
    }
    return f
  }

  private fun assetExists(name: String): Boolean =
    try {
      assets.open(name).use { true }
    } catch (e: Exception) {
      false
    }

  companion object {
    private const val TAG = "WakeWordService"

    const val ACTION_START = "com.mobile.wake.START"
    const val ACTION_STOP = "com.mobile.wake.STOP"
    const val ACTION_PAUSE = "com.mobile.wake.PAUSE"
    const val ACTION_RESUME = "com.mobile.wake.RESUME"
    const val ACTION_HEARTBEAT = "com.mobile.wake.HEARTBEAT"
    const val ACTION_START_TURN = "com.mobile.wake.START_TURN"
    const val ACTION_STOP_TURN = "com.mobile.wake.STOP_TURN"

    const val PREFS = "mia_wake"
    const val KEY_ENABLED = "enabled"
    const val KEY_KEYWORD_ASSET = "keyword_asset"
    const val KEY_THRESHOLD = "threshold"
    const val KEY_TRIGGER = "trigger"

    /** Custom "Mia" wake model (trained free via the oWW Colab, dropped into
     *  assets/). Until it exists we fall back to a pretrained model so the flow
     *  is testable end-to-end. */
    const val MIA_MODEL_ASSET = "mia.onnx"
    const val FALLBACK_MODEL_ASSET = "hey_jarvis_v0.1.onnx"

    /** Score in [0,1] a frame must reach, and consecutive frames required. */
    const val DEFAULT_THRESHOLD = 0.5f
    const val DEFAULT_TRIGGER = 3

    // ---- smart start ("Mia, pause" in one breath) ----
    /** Result of a background turn's smart start, read by
     *  [WakeWordModule.consumeEarlyTurn]. */
    const val EARLY_NONE = 0
    const val EARLY_PENDING = 1
    const val EARLY_DONE = 2
    @Volatile @JvmStatic var earlyTurnState: Int = EARLY_NONE
    /** Base64 PCM16 16 kHz; null = the user stopped after "Mia". */
    @Volatile @JvmStatic var earlyTurnAudio: String? = null
    /** Audio kept from before detection: ~1.1 s. */
    private const val PREROLL_CHUNKS = 14
    /** Detection-loop levels the noise floor is taken from: ~3 s. */
    private const val FLOOR_CHUNKS = 38
    private const val CHUNK_MS = 80L
    /** Speech must be under way at detection or start within this. */
    private const val EARLY_GRACE_MS = 800L
    /** Commands are short; also bounds endpointing over loud music. */
    private const val EARLY_MAX_RECORD_MS = 5000L

    private const val SAMPLE_RATE = 16000
    private const val CHUNK_SHORTS = 1280 // 80 ms @ 16 kHz

    // ---- turn-capture VAD (energy-based endpointing) ----
    // These MIRROR mobile/src/hooks/useSilenceAutoStop.ts, which is the in-app
    // orb's VAD. Both consume the same 0..1 dBFS curve (chunkLevel here,
    // rmsLevel in pcmCapture.ts) at the same ~80ms cadence, so the constants
    // port across 1:1 — keep the two files in step when tuning either.
    //
    // This used to be one fixed absolute level used for BOTH "did they start"
    // and "are they still talking". Speech swings ~20 dB inside a sentence, so
    // trailing off at the end of a phrase read as silence and the turn ended
    // mid-sentence. Hence calibration + hysteresis below.
    /** Calibrate the room's noise floor for this long before deciding anything. */
    private const val TURN_CAL_MS = 400L
    private const val TURN_NOISE_FLOOR_MULTIPLIER = 2.2f
    /** Speech-start level = (noise floor × multiplier), clamped to this band. */
    private const val TURN_MIN_START_LEVEL = 0.32f
    private const val TURN_MAX_START_LEVEL = 0.55f
    /** Hysteresis: "still talking" bar = start × this... */
    private const val TURN_CONTINUE_RATIO = 0.75f
    /** ...or peak × this, whichever is higher. Scales to how loud this user is. */
    private const val TURN_CONTINUE_PEAK_RATIO = 0.4f
    /** An above-threshold run must last this long to count as ongoing speech. */
    private const val TURN_CONTINUE_DEBOUNCE_MS = 160L
    /** ...and this long before the turn arms at all (blocks lone noise spikes). */
    private const val TURN_VOICE_LATCH_MS = 200L
    /** Trailing silence after speech that ends the turn. */
    private const val TURN_SILENCE_MS = 900L
    /** If the user says nothing, give up after this. */
    private const val TURN_PRE_SPEECH_GRACE_MS = 7000L
    /** Hard cap on a single turn's length. */
    private const val TURN_MAX_RECORD_MS = 15000L
    /** Min gap between level events pushed to JS (~10/s). */
    private const val LEVEL_EMIT_INTERVAL_MS = 100L
    /** Let the speaker/audio route release after TTS before opening the mic, so
     *  the first frames aren't the tail of Mia's own voice. Lives here (native
     *  turn thread) rather than as a JS setTimeout, which doesn't fire while the
     *  app is backgrounded and hung the whole turn. */
    private const val TURN_SETTLE_MS = 250L

    private const val WAKE_LOCK_TAG = "mia:wake-turn"
    private const val WAKE_LOCK_TIMEOUT_MS = 60_000L
    // If a background turn hasn't re-armed detection by now, force it. Generous
    // so a legitimately long turn (record + answer) isn't cut short.
    private const val TURN_WATCHDOG_MS = 60_000L

    const val EVENT_NAME = "WakeWordEvent"

    /** Intent extra MainActivity reads to know it was launched by a wake. */
    const val EXTRA_WAKE_KEY = "mia_wake_trigger"

    private const val CHANNEL_LISTENING = "mia-wake-listening"
    private const val CHANNEL_TRIGGER = "mia-wake-trigger"
    private const val NOTIF_ONGOING = 7711
    private const val NOTIF_TRIGGER = 7712

    /** Whether the engine is currently built + listening. */
    @Volatile
    @JvmStatic
    var isRunning: Boolean = false
      private set

    /**
     * Fire an action at the service. START goes through startForegroundService
     * (it must call startForeground within 5s, which buildAndStart does first);
     * PAUSE/RESUME/STOP assume the service is already alive and use startService
     * to avoid re-arming the 5s foreground contract.
     */
    fun sendAction(context: Context, action: String) {
      val intent = Intent(context, WakeWordService::class.java).apply { this.action = action }
      try {
        if (action == ACTION_START && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        Log.w(TAG, "sendAction($action) failed", e)
      }
    }

    /** Dismiss the transient wake "incoming" notification once the UI is up. */
    fun cancelTriggerNotification(context: Context) {
      try {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .cancel(NOTIF_TRIGGER)
      } catch (_: Exception) {}
    }
  }
}
