// Mia's voice: the TTS playback engine that runs inside the orb's WebView.
//
// Moved over unchanged from the previous orb page (src/lib/orbHtml.ts). It is
// audio infrastructure, not visuals, and every odd-looking line in it is a fix
// for a real bug: the prebuffer (stutter), the ended-latency drain (clipped last
// word), the currentAudio !== a guards (a stale clip revoking the new one), and
// the context suspend on stop (speaker route bleeding into the mic).
//
// The only seams: the analyser no longer runs its own animation loop, and the
// engine publishes window.__miaTts so the renderer can read the AnalyserNode
// each frame. The audio graph is untouched: element -> analyser -> destination.
//
// Runs in its own <script> ahead of the renderer, so a WebGL failure can never
// take Mia's voice down with it. Plain string (never Function#toString — Hermes
// release builds strip function source).

export const TTS_ENGINE_JS = `
(function () {
  try {
    // True while a clip is routed through the analyser (read by the renderer
    // to decide whether the orb is visualizing Mia's voice).
    var ttsPlaying = false;

    // ─── TTS playback + real-time analyser ────────────────────────────────
    // RN sends a base64-encoded TTS file; we play it inside the WebView and
    // route it through a Web Audio AnalyserNode that the renderer reads every
    // frame. The orb's "speaking" animation is a true reading of the waveform.
    var audioCtx = null;
    var analyser = null;
    var analyserBuf = null;
    var currentAudio = null;
    var currentBlobUrl = null;

    function base64ToBlob(b64, mime) {
      var bin = atob(b64);
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }

    function revokeBlob() {
      if (currentBlobUrl) {
        try { URL.revokeObjectURL(currentBlobUrl); } catch (_) {}
        currentBlobUrl = null;
      }
    }

    function ensureCtx() {
      if (audioCtx) return true;
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      audioCtx = new Ctor();
      return true;
    }

    // Route an <audio> element through the analyser so the orb's motion is a
    // true reading of the waveform. Shared by both playback paths.
    function attachAnalyser(a) {
      var source = audioCtx.createMediaElementSource(a);
      if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        // Higher smoothing — the orb should flow with speech rather than
        // chatter on every syllable boundary. Combined with the attack/
        // release shaping in tick() this gives a noticeably smoother feel
        // without losing responsiveness on volume swells.
        analyser.smoothingTimeConstant = 0.55;
        analyserBuf = new Uint8Array(analyser.fftSize);
      }
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    }

    // The context is suspended between clips (stopTTSAudio) and at creation
    // (autoplay policy). resume() is async — starting the <audio> before it
    // completes routes the first ~300ms into a dead context, eating the head of
    // every clip. Resume first, then play.
    function resumeThen(fn) {
      if (audioCtx.state === 'suspended') audioCtx.resume().then(fn, fn);
      else fn();
    }

    function stopAnalysis() {
      ttsPlaying = false;
    }

    window.playTTSAudio = function (opts) {
      try {
        var base64 = opts && opts.base64;
        var mime = (opts && opts.mime) || 'audio/mpeg';
        if (!base64) {
          rnLog('tts-error', 'no base64 payload');
          return;
        }
        // Stop any previous playback.
        if (currentAudio) {
          try { currentAudio.pause(); } catch (_) {}
          currentAudio.src = '';
          currentAudio = null;
        }
        revokeBlob();
        stopAnalysis();

        if (!ensureCtx()) {
          rnLog('tts-error', 'AudioContext unsupported');
          return;
        }
        var blob = base64ToBlob(base64, mime);
        currentBlobUrl = URL.createObjectURL(blob);

        var a = new Audio();
        a.preload = 'auto';
        a.src = currentBlobUrl;

        a.addEventListener('ended', function () {
          // 'ended' fires when the ELEMENT finishes feeding the graph — but the
          // audio is routed through Web Audio, so the last chunk is still in the
          // output buffer and has not reached the speaker yet. Callers treat this
          // event as "the audio finished": the wake session immediately calls
          // stop() to free the audio route for recording, which suspends the
          // context and discards that tail mid-word. (In-app never stops after a
          // reply, which is why only the floating orb clipped.) Wait out the real
          // output latency so the event means what its name claims.
          var lat = 0;
          try {
            lat = (audioCtx.outputLatency || 0) + (audioCtx.baseLatency || 0);
          } catch (_) {}
          // Android WebView often reports 0 here; the floor covers that case.
          var waitMs = Math.min(Math.max(lat * 1000, 150), 400);
          setTimeout(function () {
            // A stop() or a newer clip may have landed inside the wait window.
            // Without this guard the cleanup below would revoke the NEW clip's
            // blob and cancel its analyser loop. Whoever superseded us already
            // settled the pending promise, so there is nothing left to report.
            if (currentAudio !== a) return;
            stopAnalysis();
            revokeBlob();
            currentAudio = null;
            rnLog('tts-ended', null);
          }, waitMs);
        });
        a.addEventListener('error', function () {
          stopAnalysis();
          revokeBlob();
          currentAudio = null;
          var msg = a.error ? 'audio error code ' + a.error.code : 'audio error';
          rnLog('tts-error', msg);
        });

        attachAnalyser(a);
        currentAudio = a;
        ttsPlaying = true;
        resumeThen(function () {
          var pp = a.play();
          if (pp && typeof pp.then === 'function') {
            pp.catch(function (e) {
              stopAnalysis();
              revokeBlob();
              currentAudio = null;
              rnLog('tts-error', 'play rejected: ' + (e && e.message ? e.message : String(e)));
            });
          }
        });
      } catch (err) {
        stopAnalysis();
        revokeBlob();
        rnLog('tts-error', 'playTTSAudio: ' + (err && err.message ? err.message : String(err)));
      }
    };

    // ─── Streaming TTS (MediaSource) ──────────────────────────────────────
    // The WebView fetches the audio itself and plays it as it arrives. RN can't
    // do this — its fetch has no ReadableStream — and the old path paid for that
    // twice: it waited for the COMPLETE file (~2.7s vs ~1.4s to first byte) and
    // then shipped it back over the bridge as base64.
    //
    // Ordering: RN enqueues each sentence the moment it's flushed, so fetches
    // overlap, but playback is strictly serialized. That keeps the parallel
    // synth the old RN-side code had.
    //
    // MediaSource also fixes duration honestly: endOfStream() states the exact
    // length, so nothing has to estimate from bitrate (which is what clipped the
    // final syllable when we fed streamed MP3 to a plain <audio>).
    var speakQueue = [];
    var speakActive = null;

    // Seconds of audio to bank before letting playback start.
    //
    // Do NOT set this from the average delivery rate. Measured end-to-end,
    // ElevenLabs returns ~2.9s of audio between first byte (~1.4s) and complete
    // (~2.7s) — ~2x realtime, which says "start immediately, it can't run dry".
    // That average is a lie: delivery is BURSTY, and playback started on the
    // first byte drains its buffer during the gaps between bursts and stutters
    // (~0.1s hiccups mid-word). This is the margin that absorbs a gap.
    //
    // Cost/benefit: bigger = safer but starts later, and at 1.2s we still start
    // ~0.8s earlier than waiting for the whole file. Raise it if stutter ever
    // comes back; it can never be lower than the longest burst gap.
    var PREBUFFER_SECONDS = 1.2;

    function streamSupported() {
      try {
        return !!(window.MediaSource && MediaSource.isTypeSupported('audio/mpeg'));
      } catch (_) { return false; }
    }

    function settle(item, kind, payload) {
      if (item.settled) return;
      item.settled = true;
      if (speakActive === item) speakActive = null;
      rnLog(kind, payload ? { id: item.id, error: payload } : { id: item.id });
      pumpQueue();
    }

    function pumpQueue() {
      if (speakActive) return;
      var item = null;
      while (speakQueue.length) {
        var head = speakQueue.shift();
        if (!head.aborted) { item = head; break; }
      }
      if (!item) return;
      speakActive = item;
      playStreamItem(item);
    }

    function playStreamItem(item) {
      if (item.error && !item.chunks.length) { settle(item, 'tts-error', item.error); return; }
      if (!ensureCtx()) { settle(item, 'tts-error', 'AudioContext unsupported'); return; }

      var ms = new MediaSource();
      var a = new Audio();
      a.preload = 'auto';
      currentBlobUrl = URL.createObjectURL(ms);
      a.src = currentBlobUrl;

      ms.addEventListener('sourceopen', function () {
        var sb;
        try { sb = ms.addSourceBuffer('audio/mpeg'); }
        catch (e) { settle(item, 'tts-error', 'addSourceBuffer: ' + e); return; }

        var idx = 0;
        function feed() {
          if (item.aborted || sb.updating || ms.readyState !== 'open') return;
          if (idx < item.chunks.length) {
            try { sb.appendBuffer(item.chunks[idx++]); }
            catch (e) { settle(item, 'tts-error', 'appendBuffer: ' + e); return; }
            return; // 'updateend' re-enters feed()
          }
          if (item.done) {
            // Everything fed. Declaring end-of-stream is what gives the element
            // an exact duration — the thing streamed MP3 can't tell it.
            try { ms.endOfStream(); } catch (_) {}
            maybeStart(); // short clip: may never have reached the prebuffer
            return;
          }
          // Ran dry mid-generation: wait for the fetch to deliver more.
          item.onChunk = feed;
          maybeStart();
        }
        sb.addEventListener('updateend', function () {
          feed();
          maybeStart();
        });
        item.onChunk = feed;
        feed();
      });

      // Audio actually banked in the element, in seconds. Ask the element, not
      // the byte count: it knows what it decoded, bytes are a guess.
      function bufferedSeconds() {
        try {
          if (!a.buffered || !a.buffered.length) return 0;
          return a.buffered.end(a.buffered.length - 1) - (a.currentTime || 0);
        } catch (_) { return 0; }
      }

      var started = false;
      function maybeStart() {
        if (started || item.aborted) return;
        // item.done short-circuits the margin: a clip shorter than
        // PREBUFFER_SECONDS ("კარგი.") would otherwise never reach it and would
        // sit here in silence until the timeout.
        if (!item.done && bufferedSeconds() < PREBUFFER_SECONDS) return;
        started = true;
        resumeThen(function () {
          if (item.aborted) return;
          var pp = a.play();
          if (pp && typeof pp.then === 'function') {
            pp.catch(function (e) {
              stopAnalysis();
              revokeBlob();
              currentAudio = null;
              settle(item, 'tts-error', 'play rejected: ' + (e && e.message ? e.message : String(e)));
            });
          }
        });
      }

      a.addEventListener('ended', function () {
        // Same drain as the blob path: 'ended' fires when the element stops
        // feeding the graph, not when sound reaches the speaker. Callers
        // (the wake session) suspend the context right after, which would cut
        // the tail mid-word.
        var lat = 0;
        try { lat = (audioCtx.outputLatency || 0) + (audioCtx.baseLatency || 0); } catch (_) {}
        var waitMs = Math.min(Math.max(lat * 1000, 150), 400);
        setTimeout(function () {
          if (currentAudio !== a) return;
          stopAnalysis();
          revokeBlob();
          currentAudio = null;
          settle(item, 'tts-ended', null);
        }, waitMs);
      });
      a.addEventListener('error', function () {
        stopAnalysis();
        revokeBlob();
        currentAudio = null;
        settle(item, 'tts-error', a.error ? 'audio error ' + a.error.code : 'audio error');
      });

      // 'playing' is the honest "sound is coming out now" signal: with a
      // MediaSource the element waits for enough buffered data, so this can be
      // a second or more after play() is called. RN flips the orb to "speaking"
      // on this, not before.
      a.addEventListener('playing', function () {
        rnLog('tts-started', { id: item.id });
      });

      try { attachAnalyser(a); } catch (e) { settle(item, 'tts-error', 'attach: ' + e); return; }
      currentAudio = a;
      ttsPlaying = true;
      // No play() here — maybeStart() fires once PREBUFFER_SECONDS is banked (or
      // the clip is fully in). Starting on the first byte is what stuttered.
      maybeStart();
    }

    // RN calls this per sentence, immediately on flush (not chained).
    window.speakTTSStream = function (opts) {
      var item = {
        id: opts && opts.id,
        chunks: [], done: false, error: null,
        aborted: false, settled: false, onChunk: null,
      };
      if (!streamSupported()) { rnLog('tts-error', { id: item.id, error: 'no-mse' }); return; }
      speakQueue.push(item);

      var ctrl = null;
      try { ctrl = new AbortController(); } catch (_) {}
      item.ctrl = ctrl;

      fetch(opts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.token },
        body: JSON.stringify({ text: opts.text }),
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (!res.body || !res.body.getReader) throw new Error('no-stream-body');
          var reader = res.body.getReader();
          function pump() {
            return reader.read().then(function (r) {
              if (item.aborted) { try { reader.cancel(); } catch (_) {} return; }
              if (r.done) { item.done = true; if (item.onChunk) item.onChunk(); return; }
              item.chunks.push(r.value);
              if (item.onChunk) item.onChunk();
              return pump();
            });
          }
          return pump();
        })
        .catch(function (e) {
          if (item.aborted) return;
          item.error = String((e && e.message) || e);
          item.done = true;
          if (item.onChunk) item.onChunk();
          // Nothing ever arrived and we're not the one playing → report now;
          // otherwise playStreamItem reports when its turn comes.
          if (speakActive !== item && !item.chunks.length) settle(item, 'tts-error', item.error);
        });

      pumpQueue();
    };

    window.stopTTSAudio = function () {
      for (var i = 0; i < speakQueue.length; i++) speakQueue[i].aborted = true;
      speakQueue.length = 0;
      if (speakActive) {
        speakActive.aborted = true;
        try { if (speakActive.ctrl) speakActive.ctrl.abort(); } catch (_) {}
        speakActive.settled = true; // RN settles its own promise on stop()
        speakActive = null;
      }
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.src = '';
          currentAudio = null;
        }
      } catch (_) {}
      revokeBlob();
      stopAnalysis();
      // Release the output audio route so a subsequent mic recording starts
      // clean. A running AudioContext keeps the loudspeaker route active, which
      // on some devices bleeds a constant level into the mic and stalls silence
      // detection. playTTSAudio resumes it for the next clip.
      try {
        if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
      } catch (_) {}
    };

    window.__miaTts = {
      analyser: function () { return analyser; },
      context: function () { return audioCtx; },
      playing: function () { return ttsPlaying && !!analyser; }
    };
  } catch (err) {
    rnLog('error', 'tts init: ' + String((err && err.message) || err));
  }
})();
`;
