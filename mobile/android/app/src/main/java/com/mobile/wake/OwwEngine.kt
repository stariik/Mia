package com.mobile.wake

import android.content.Context
import android.util.Log
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * On-device "Hey Mia" wake-word detector using openWakeWord
 * (https://github.com/dscripka/openWakeWord, Apache-2.0) via ONNX Runtime.
 *
 * openWakeWord is a three-stage pipeline, all running locally — no account,
 * key, or per-user licensing, which is why we moved off Picovoice Porcupine:
 *
 *   16 kHz PCM ─▶ melspectrogram.onnx ─▶ embedding_model.onnx ─▶ <wakeword>.onnx
 *     (audio)        (mel frames, 32       (Google speech         (score 0..1)
 *                     bins/frame)           embedding, 96-dim)
 *
 * This is a faithful port of the reference streaming preprocessor
 * (`openwakeword/utils.py::AudioFeatures._streaming_features` and
 * `openwakeword/model.py::Model.predict`). We always feed exactly 1280-sample
 * (80 ms) chunks, which collapses the reference's general buffering to a clean
 * per-chunk step:
 *
 *   1 chunk (1280 samples)
 *     → melspectrogram of the last (1280 + 480) samples → +8 mel frames
 *     → embedding of the most recent 76 mel frames       → +1 feature frame
 *     → wakeword model over the last N feature frames     → 1 score
 *
 * The +480 (3 mel frames) of left-context matches the reference slice
 * `raw_data_buffer[-n_samples - 160*3:]`; the melspectrogram model emits
 * `ceil(len/160 - 3)` frames, so 1760 samples → 8 frames "belonging" to the new
 * 1280, i.e. non-overlapping output. The mel transform `x/10 + 2` matches the
 * reference (aligns the ONNX melspec model to Google's native TF one).
 *
 * Detection requires `triggerLevel` consecutive frames at/above `threshold`,
 * then enters a short refractory period so one utterance fires once. All state
 * is single-threaded — only the capture thread touches an instance.
 *
 * Not thread-safe. Call [process]/[reset] from one thread; [close] after the
 * capture thread has joined.
 */
class OwwEngine(
  context: Context,
  wakeModelAsset: String,
  private val threshold: Float,
  private val triggerLevel: Int,
) : AutoCloseable {

  private val env: OrtEnvironment = OrtEnvironment.getEnvironment()

  private val melSession: OrtSession
  private val embSession: OrtSession
  private val wakeSession: OrtSession

  private val melInput: String
  private val embInput: String
  private val wakeInput: String

  /** Feature frames the wake model expects (its input shape[1]); usually 16. */
  private val needFrames: Int

  // ---- streaming buffers (mirror the reference AudioFeatures state) ----------

  /** Most recent raw samples; we only ever melspec the last [RAW_TAIL]. */
  private var rawTail = ShortArray(0)

  /** Leftover samples when a read isn't a whole multiple of [CHUNK]. */
  private var pending = ShortArray(0)

  /** Mel frames (each [MEL_BINS] wide). Seeded with 76 ones like the reference. */
  private val melBuffer = ArrayDeque<FloatArray>()

  /** Speech-embedding frames (each [EMB_DIM] wide). */
  private val featureBuffer = ArrayDeque<FloatArray>()

  private var framesProcessed = 0
  private var consecutive = 0
  private var refractory = 0
  var lastScore = 0f
    private set

  init {
    val opts = OrtSession.SessionOptions().apply {
      // Always-on: keep CPU use modest and predictable.
      setIntraOpNumThreads(1)
      setInterOpNumThreads(1)
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    }
    melSession = env.createSession(readAsset(context, MEL_ASSET), opts)
    embSession = env.createSession(readAsset(context, EMB_ASSET), opts)
    wakeSession = env.createSession(readAsset(context, wakeModelAsset), opts)

    melInput = melSession.inputNames.first()
    embInput = embSession.inputNames.first()
    wakeInput = wakeSession.inputNames.first()

    val wakeShape = (wakeSession.inputInfo[wakeInput]!!.info as TensorInfo).shape
    needFrames = wakeShape.getOrNull(1)?.let { if (it > 0) it.toInt() else DEFAULT_FRAMES }
      ?: DEFAULT_FRAMES

    seedMelBuffer()
    Log.i(TAG, "openWakeWord engine ready (wake='$wakeModelAsset', frames=$needFrames).")
  }

  /** Clear all streaming state — call on resume so stale audio can't self-fire. */
  fun reset() {
    rawTail = ShortArray(0)
    pending = ShortArray(0)
    featureBuffer.clear()
    framesProcessed = 0
    consecutive = 0
    refractory = 0
    lastScore = 0f
    seedMelBuffer()
  }

  /**
   * Feed captured PCM16 mono @ 16 kHz. Accumulates to whole 80 ms chunks and
   * runs the pipeline on each. Returns true if a fresh detection fired in this
   * call. May throw if an ONNX run fails (the caller stops + reports).
   */
  fun process(samples: ShortArray, len: Int): Boolean {
    pending = if (pending.isEmpty()) samples.copyOf(len) else pending + samples.copyOf(len)
    var fired = false
    while (pending.size >= CHUNK) {
      val chunk = pending.copyOfRange(0, CHUNK)
      pending = pending.copyOfRange(CHUNK, pending.size)
      if (processChunk(chunk)) fired = true
    }
    return fired
  }

  private fun processChunk(chunk: ShortArray): Boolean {
    // --- melspectrogram of the last (CHUNK + 480) raw samples -----------------
    rawTail = if (rawTail.isEmpty()) chunk else rawTail + chunk
    if (rawTail.size > RAW_TAIL) {
      rawTail = rawTail.copyOfRange(rawTail.size - RAW_TAIL, rawTail.size)
    }
    appendMelFrames(rawTail)
    while (melBuffer.size > MEL_MAX) melBuffer.removeFirst()

    // --- one embedding from the most recent 76 mel frames ---------------------
    appendEmbedding()
    while (featureBuffer.size > FEATURE_MAX) featureBuffer.removeFirst()
    framesProcessed++

    // --- wake-word score over the last needFrames embeddings ------------------
    if (refractory > 0) refractory--
    if (framesProcessed <= needFrames + WARMUP_FRAMES || featureBuffer.size < needFrames) {
      return false
    }
    val score = wakeScore()
    lastScore = score

    if (score >= threshold && refractory == 0) {
      consecutive++
      if (consecutive >= triggerLevel) {
        consecutive = 0
        refractory = REFRACTORY_FRAMES
        return true
      }
    } else if (score < threshold) {
      consecutive = 0
    }
    return false
  }

  // ---- model stages ---------------------------------------------------------

  /** Run the melspec model over [audio] and push each output frame (x/10 + 2).
   *  Output is [1, 1, frames, 32], read flat row-major from the float buffer. */
  private fun appendMelFrames(audio: ShortArray) {
    val fb = directFloats(audio.size)
    for (s in audio) fb.put(s.toFloat())
    fb.rewind()
    OnnxTensor.createTensor(env, fb, longArrayOf(1, audio.size.toLong())).use { t ->
      melSession.run(java.util.Collections.singletonMap(melInput, t)).use { res ->
        val out = (res[0] as OnnxTensor).floatBuffer
        val frames = out.remaining() / MEL_BINS
        repeat(frames) {
          val mf = FloatArray(MEL_BINS)
          for (b in 0 until MEL_BINS) mf[b] = out.get() / 10f + 2f
          melBuffer.addLast(mf)
        }
      }
    }
  }

  /** Run the embedding model over the most recent 76 mel frames → 96-d vector.
   *  Output flattens to EMB_DIM floats regardless of leading singleton dims. */
  private fun appendEmbedding() {
    val start = melBuffer.size - MEL_WINDOW
    val fb = directFloats(MEL_WINDOW * MEL_BINS)
    for (i in 0 until MEL_WINDOW) {
      val frame = melBuffer[start + i]
      for (b in 0 until MEL_BINS) fb.put(frame[b])
    }
    fb.rewind()
    OnnxTensor.createTensor(
      env, fb, longArrayOf(1, MEL_WINDOW.toLong(), MEL_BINS.toLong(), 1),
    ).use { t ->
      embSession.run(java.util.Collections.singletonMap(embInput, t)).use { res ->
        val out = (res[0] as OnnxTensor).floatBuffer
        val emb = FloatArray(EMB_DIM)
        for (b in 0 until EMB_DIM) emb[b] = out.get()
        featureBuffer.addLast(emb)
      }
    }
  }

  /** Run the wake model over the last needFrames embeddings → score in [0,1]. */
  private fun wakeScore(): Float {
    val start = featureBuffer.size - needFrames
    val fb = directFloats(needFrames * EMB_DIM)
    for (i in 0 until needFrames) {
      val frame = featureBuffer[start + i]
      for (b in 0 until EMB_DIM) fb.put(frame[b])
    }
    fb.rewind()
    OnnxTensor.createTensor(
      env, fb, longArrayOf(1, needFrames.toLong(), EMB_DIM.toLong()),
    ).use { t ->
      wakeSession.run(java.util.Collections.singletonMap(wakeInput, t)).use { res ->
        // Output is [1, 1] (binary classifier) — first element is the score.
        return (res[0] as OnnxTensor).floatBuffer.get(0)
      }
    }
  }

  // ---- helpers --------------------------------------------------------------

  private fun seedMelBuffer() {
    melBuffer.clear()
    repeat(MEL_WINDOW) { melBuffer.addLast(FloatArray(MEL_BINS) { 1f }) }
  }

  override fun close() {
    runCatching { melSession.close() }
    runCatching { embSession.close() }
    runCatching { wakeSession.close() }
    // env is the shared process-wide environment; do not close it.
  }

  companion object {
    private const val TAG = "OwwEngine"

    /** Shared feature models bundled in assets/ (downloaded from oWW releases). */
    const val MEL_ASSET = "melspectrogram.onnx"
    const val EMB_ASSET = "embedding_model.onnx"

    private const val CHUNK = 1280 // 80 ms @ 16 kHz
    private const val RAW_TAIL = CHUNK + 480 // + 3 mel frames of left context
    private const val MEL_BINS = 32
    private const val MEL_WINDOW = 76 // mel frames per embedding
    private const val EMB_DIM = 96
    private const val MEL_MAX = 10 * 97 // ~10 s, reference melspectrogram_max_len
    private const val FEATURE_MAX = 120 // reference feature_buffer_max_len
    private const val DEFAULT_FRAMES = 16 // wake model frames if shape is dynamic

    /** Extra warm-up chunks so the first scored window holds only settled
     *  embeddings (the seeded mel ones have scrolled out). ~0.6 s on top of the
     *  needFrames fill. Belt-and-braces against a startup false positive. */
    private const val WARMUP_FRAMES = 8

    /** Chunks to ignore detections after firing — one utterance fires once.
     *  ~2 s; the service also pauses the mic on detect, this just covers the
     *  async gap. */
    private const val REFRACTORY_FRAMES = 25

    private fun readAsset(context: Context, name: String): ByteArray =
      context.assets.open(name).use { it.readBytes() }

    private fun directFloats(size: Int): FloatBuffer =
      ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
  }
}
