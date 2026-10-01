/** Wire protocol v1. One socket owns exactly one utterance; audio is binary PCM16LE. */
/** Spoken languages the gateway accepts; `start.language` defaults to 'ka'. */
export const LANGUAGES = ['ka', 'ru', 'en', 'de', 'fr', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];
export type Identity = { sessionId: string; utteranceId: string };
export type Start = Identity & {
  type: 'start';
  version: 1;
  token: string;
  sampleRate: 16000;
  channels: 1;
  encoding: 'pcm16';
  language?: Language;
};
export type ClientMessage =
  | Start
  | (Identity & { type: 'finish' | 'cancel' | 'keep_listening' });
export type ErrorCode =
  | 'unauthorized'
  | 'disabled'
  | 'quota'
  | 'rate_limit'
  | 'protocol'
  | 'provider'
  | 'connection_timeout'
  | 'finalization_timeout'
  | 'stalled'
  | 'no_speech'
  | 'unavailable';
export type ServerMessage = Identity &
  (
    | { type: 'ready'; provider: 'elevenlabs' | 'google'; maxDurationMs: 60000 }
    | { type: 'partial'; text: string }
    | { type: 'segment'; segment: number; text: string }
    | { type: 'endpoint' }
    | { type: 'audio_ack'; receivedBytes: number }
    | { type: 'final'; text: string }
    | { type: 'error'; code: ErrorCode; message: string; retryable: boolean }
  );
