import WebSocket from 'ws';
import { v2 } from '@google-cloud/speech';

export type ProviderEvent =
  | { type: 'ready' | 'endpoint' | 'speech' | 'done' }
  | { type: 'partial' | 'segment'; text: string }
  | { type: 'error' };
export interface Provider {
  write(audio: Buffer): void;
  finish(): void;
  cancel(): void;
}
export type ProviderFactory = (
  name: 'google' | 'elevenlabs',
  emit: (event: ProviderEvent) => void,
) => Provider;

export function elevenlabs(
  emit: (event: ProviderEvent) => void,
  connect = (url: URL, options: WebSocket.ClientOptions) =>
    new WebSocket(url, options),
): Provider {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Missing ElevenLabs credentials');
  const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
  Object.entries({
    model_id: 'scribe_v2_realtime',
    audio_format: 'pcm_16000',
    language_code: 'ka',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: '1.2',
    no_verbatim: 'false',
    include_timestamps: 'true',
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const ws = connect(url, {
    headers: { 'xi-api-key': key },
    handshakeTimeout: 5000,
    maxPayload: 65536,
  });
  let stopped = false;
  let finishing = false;
  let sentSeconds = 0;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  // Hold the newest packet until the next write, so Finish commits real tail audio.
  let tail: Buffer | undefined;
  const send = (audio: Buffer, commit = false) => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64000)
      throw new Error('Upstream stalled');
    ws.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: audio.toString('base64'),
        sample_rate: 16000,
        commit,
      }),
    );
    sentSeconds += audio.length / 32000;
  };
  ws.on('message', (raw) => {
    if (stopped) return;
    try {
      const event = JSON.parse(raw.toString());
      if (event.message_type === 'session_started') emit({ type: 'ready' });
      else if (
        event.message_type === 'partial_transcript' &&
        typeof event.text === 'string'
      ) {
        emit({ type: 'partial', text: event.text });
        if (event.text.trim()) emit({ type: 'speech' });
      } else if (
        event.message_type === 'committed_transcript' &&
        typeof event.text === 'string'
      ) {
        if (event.text.trim()) emit({ type: 'segment', text: event.text });
        if (finishing) {
          // A nonempty commit might be an in-flight VAD segment. Drain through an
          // empty explicit commit before declaring the entire audio input complete.
          // If the provider never acknowledges the drain, the gateway times out.
          if (!event.text.trim()) {
            clearTimeout(drainTimer);
            emit({ type: 'done' });
          } else {
            clearTimeout(drainTimer);
            drainTimer = setTimeout(() => {
              try {
                send(Buffer.alloc(0), true);
              } catch {
                emit({ type: 'error' });
              }
            }, 300);
          }
        }
      } else if (
        event.message_type === 'committed_transcript_with_timestamps' &&
        !finishing
      ) {
        // Provider hard segment limits are not a user turn boundary. Require a
        // provider timestamp showing a full pause after the latest spoken word.
        const words = Array.isArray(event.words)
          ? event.words.filter(
              (w: { type?: string; end?: number }) =>
                w.type === 'word' && Number.isFinite(w.end),
            )
          : [];
        const end = words.at(-1)?.end;
        if (typeof end === 'number' && sentSeconds - end >= 1.2)
          emit({ type: 'endpoint' });
      } else if (
        !['warning', 'committed_transcript_with_timestamps'].includes(
          event.message_type,
        )
      )
        emit({ type: 'error' });
    } catch {
      emit({ type: 'error' });
    }
  });
  ws.on('error', () => {
    if (!stopped) emit({ type: 'error' });
  });
  ws.on('close', () => {
    if (!stopped) emit({ type: 'error' });
  });
  return {
    write(audio) {
      if (tail) send(tail);
      tail = audio;
    },
    finish() {
      finishing = true;
      send(tail ?? Buffer.alloc(0), true);
      tail = undefined;
    },
    cancel() {
      stopped = true;
      clearTimeout(drainTimer);
      tail = undefined;
      ws.terminate();
    },
  };
}

export function google(
  emit: (event: ProviderEvent) => void,
  clientFactory = (region: string) =>
    new v2.SpeechClient({ apiEndpoint: `${region}-speech.googleapis.com` }),
): Provider {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.STT_GOOGLE_REGION;
  if (
    !project ||
    !region ||
    process.env.STT_GOOGLE_PREVIEW_VERIFIED !== 'true'
  ) {
    throw new Error(
      'Verify Georgian Chirp 3 streaming in the configured project and region first',
    );
  }
  const client = clientFactory(region);
  const stream = client._streamingRecognize();
  let stopped = false;
  let finishing = false;
  let pause: ReturnType<typeof setTimeout> | undefined;
  stream.on('data', (response) => {
    if (stopped) return;
    const event = response.speechEventType;
    if (event === 'SPEECH_ACTIVITY_BEGIN' || event === 2) {
      clearTimeout(pause);
      emit({ type: 'speech' });
    } else if (event === 'SPEECH_ACTIVITY_END' || event === 3) {
      clearTimeout(pause);
      pause = setTimeout(() => {
        if (!stopped && !finishing) emit({ type: 'endpoint' });
      }, 1200);
    }
    for (const result of response.results ?? []) {
      const text = result.alternatives?.[0]?.transcript;
      if (typeof text === 'string')
        emit({ type: result.isFinal ? 'segment' : 'partial', text });
    }
  });
  stream.on('error', () => {
    if (!stopped) emit({ type: 'error' });
  });
  stream.on('end', () => {
    if (!stopped) emit({ type: finishing ? 'done' : 'error' });
  });
  stream.write({
    recognizer: `projects/${project}/locations/${region}/recognizers/_`,
    streamingConfig: {
      config: {
        model: 'chirp_3',
        languageCodes: ['ka-GE'],
        explicitDecodingConfig: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          audioChannelCount: 1,
        },
        features: { enableAutomaticPunctuation: true },
      },
      streamingFeatures: {
        interimResults: true,
        enableVoiceActivityEvents: true,
      },
    },
  });
  // gRPC reports authentication/config errors asynchronously; ready allows audio flow.
  queueMicrotask(() => {
    if (!stopped) emit({ type: 'ready' });
  });
  return {
    write(audio) {
      if (stream.writableLength >= 20) throw new Error('Upstream stalled');
      stream.write({ audio });
    },
    finish() {
      finishing = true;
      clearTimeout(pause);
      stream.end();
    },
    cancel() {
      stopped = true;
      clearTimeout(pause);
      stream.destroy();
      void client.close().catch(() => {});
    },
  };
}
export const createProvider: ProviderFactory = (name, emit) =>
  name === 'google' ? google(emit) : elevenlabs(emit);
