import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { elevenlabs, google, type ProviderEvent } from './providers';

class Wire extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  writableLength = 0;
  messages: Record<string, unknown>[] = [];
  destroyed = false;
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
  terminate() {
    this.destroyed = true;
  }
  write(data: Record<string, unknown>) {
    this.messages.push(data);
    return true;
  }
  end() {}
  destroy() {
    this.destroyed = true;
  }
  message(data: object) {
    this.emit('message', Buffer.from(JSON.stringify(data)));
  }
}
test('ElevenLabs normalizes segment events and drains final audio past pending VAD commits', async () => {
  process.env.ELEVENLABS_API_KEY = 'fake';
  const wire = new Wire();
  const events: ProviderEvent[] = [];
  const adapter = elevenlabs(
    (e) => events.push(e),
    (url, options) => {
      assert.equal(url.searchParams.get('language_code'), 'ka');
      assert.equal(url.searchParams.get('vad_silence_threshold_secs'), '1.2');
      assert.ok(options.headers);
      return wire as unknown as WebSocket;
    },
  );
  wire.message({ message_type: 'session_started' });
  const tail = Buffer.from([1, 2, 3, 4]);
  adapter.write(Buffer.alloc(3200));
  adapter.write(tail);
  wire.message({ message_type: 'partial_transcript', text: 'hello' });
  adapter.finish();
  assert.equal(wire.messages.at(-1)?.audio_base_64, tail.toString('base64'));
  wire.message({ message_type: 'committed_transcript', text: 'hello' });
  assert.equal(
    events.some((e) => e.type === 'done'),
    false,
  );
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(wire.messages.at(-1)?.audio_base_64, '');
  wire.message({ message_type: 'committed_transcript', text: 'tail' });
  assert.equal(
    events.some((e) => e.type === 'done'),
    false,
  );
  wire.message({ message_type: 'committed_transcript', text: '' });
  assert.equal(events.filter((e) => e.type === 'done').length, 1);
  adapter.cancel();
  assert.equal(wire.destroyed, true);
});
test('ElevenLabs hard segments do not end turns; timestamped pauses can', () => {
  const wire = new Wire();
  const events: ProviderEvent[] = [];
  const adapter = elevenlabs(
    (e) => events.push(e),
    () => wire as unknown as WebSocket,
  );
  for (let i = 0; i < 31; i++) adapter.write(Buffer.alloc(3200));
  wire.message({ message_type: 'committed_transcript', text: 'speech' });
  wire.message({
    message_type: 'committed_transcript_with_timestamps',
    words: [{ type: 'word', end: 2.8 }],
  });
  assert.equal(
    events.some((e) => e.type === 'endpoint'),
    false,
  );
  wire.message({
    message_type: 'committed_transcript_with_timestamps',
    words: [{ type: 'word', end: 1.7 }],
  });
  assert.equal(events.filter((e) => e.type === 'endpoint').length, 1);
  adapter.cancel();
});
test('Google keeps results separate from speech events and waits for stream end after finish', async () => {
  process.env.GOOGLE_CLOUD_PROJECT = 'fake';
  process.env.STT_GOOGLE_REGION = 'eu';
  process.env.STT_GOOGLE_PREVIEW_VERIFIED = 'true';
  const wire = new Wire();
  const events: ProviderEvent[] = [];
  let closed = false;
  const adapter = google(
    (e) => events.push(e),
    () =>
      ({
        _streamingRecognize: () => wire,
        close: async () => {
          closed = true;
        },
      } as never),
  );
  await Promise.resolve();
  wire.emit('data', {
    speechEventType: 2,
    results: [{ isFinal: false, alternatives: [{ transcript: 'one' }] }],
  });
  wire.emit('data', {
    results: [{ isFinal: true, alternatives: [{ transcript: 'one two' }] }],
  });
  assert.equal(
    events.some((e) => e.type === 'done' || e.type === 'endpoint'),
    false,
  );
  adapter.finish();
  wire.emit('end');
  assert.equal(events.at(-1)?.type, 'done');
  adapter.cancel();
  assert.equal(closed, true);
  assert.equal(wire.destroyed, true);
});

test('ElevenLabs asks Scribe for the requested spoken language', () => {
  process.env.ELEVENLABS_API_KEY = 'fake';
  let code: string | null = null;
  const adapter = elevenlabs(
    () => {},
    (url) => {
      code = url.searchParams.get('language_code');
      return new Wire() as unknown as WebSocket;
    },
    'ru',
  );
  adapter.cancel();
  assert.equal(code, 'ru');
});
