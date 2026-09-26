import { PcmPacketizer } from '../src/stt/audio';
import { SttController, type Socket } from '../src/stt/controller';

function convert(rate: number, frames: number, chunk: number) {
  const packets: ArrayBuffer[] = [];
  const converter = new PcmPacketizer(p => packets.push(p));
  const input = Int16Array.from({ length: frames * 2 }, (_, i) =>
    Math.round(Math.sin(Math.floor(i / 2) * 0.1) * 20000),
  );
  for (let i = 0; i < frames; i += chunk)
    converter.push(
      input.slice(i * 2, Math.min(frames, i + chunk) * 2).buffer,
      rate,
      2,
    );
  converter.flush();
  return packets.flatMap(p => Array.from(new Int16Array(p)));
}
test.each([16000, 44100, 48000])(
  'resampling at %i is independent of callback boundaries and retains tail',
  rate => {
    const frames = rate * 23 + 17;
    const whole = convert(rate, frames, frames);
    expect(convert(rate, frames, 511)).toEqual(whole);
    expect(whole).toHaveLength(Math.ceil((frames * 16000) / rate));
  },
);
test('changing audio route fails explicitly', () => {
  const p = new PcmPacketizer(() => {});
  p.push(new ArrayBuffer(10), 48000, 1);
  expect(() => p.push(new ArrayBuffer(10), 44100, 1)).toThrow('route changed');
});

function harness(start?: () => Promise<void>) {
  let frame!: (data: ArrayBuffer, rate: number, channels: number) => void;
  let interrupt!: () => void;
  const ws: Socket = {
    readyState: 1,
    bufferedAmount: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn(),
    close: jest.fn(),
  };
  const capture = {
    start: jest.fn(async (f, i) => {
      frame = f;
      interrupt = i;
      await start?.();
    }),
    stop: jest.fn(),
  };
  const partial = jest.fn();
  const controller = new SttController({
    socket: () => ws,
    capture,
    identity: { sessionId: 's', utteranceId: 'u' },
    token: 'token',
    state: jest.fn(),
    elapsed: jest.fn(),
    partial,
  });
  const event = (e: object) =>
    ws.onmessage?.({
      data: JSON.stringify({ sessionId: 's', utteranceId: 'u', ...e }),
    });
  return {
    controller,
    ws,
    capture,
    partial,
    event,
    frame: (n = 1600) => frame(new ArrayBuffer(n * 2), 16000, 1),
    interrupt: () => interrupt(),
  };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
async function ready(h: ReturnType<typeof harness>) {
  h.ws.onopen?.();
  h.event({ type: 'ready' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
test('partials/segments never resolve a turn; finish flushes tail exactly once', async () => {
  const h = harness();
  const result = h.controller.start();
  await ready(h);
  h.frame(1617);
  h.event({ type: 'segment', text: 'one' });
  h.event({ type: 'partial', text: 'one two' });
  expect(h.controller.state).toBe('listening');
  h.controller.finish();
  h.controller.finish();
  const calls = (h.ws.send as jest.Mock).mock.calls.map(c => c[0]);
  expect(
    calls.filter(c => c instanceof ArrayBuffer).map(c => c.byteLength),
  ).toEqual([3200, 34]);
  expect(
    calls.filter(c => typeof c === 'string' && JSON.parse(c).type === 'finish'),
  ).toHaveLength(1);
  h.event({ type: 'final', text: 'one two' });
  expect(await result).toBe('one two');
  expect(h.ws.close).toHaveBeenCalledTimes(1);
});
test('cancel during native start cleans up again when start settles; late events do nothing', async () => {
  let settle!: () => void;
  const h = harness(
    () =>
      new Promise<void>(r => {
        settle = r;
      }),
  );
  const result = h.controller.start();
  h.ws.onopen?.();
  h.event({ type: 'ready' });
  const late = h.ws.onmessage!;
  h.controller.cancel();
  settle();
  await Promise.resolve();
  await Promise.resolve();
  late({
    data: JSON.stringify({
      sessionId: 's',
      utteranceId: 'u',
      type: 'final',
      text: 'ghost',
    }),
  });
  expect(await result).toBeNull();
  expect(h.controller.state).toBe('idle');
  expect(h.capture.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
});
test('keep listening ignores automatic endpoints; 60 seconds still finishes', async () => {
  const h = harness();
  const result = h.controller.start();
  await ready(h);
  h.controller.keepListening();
  h.event({ type: 'endpoint' });
  expect(h.controller.state).toBe('listening');
  for (let i = 0; i < 600; i++) {
    h.frame();
    h.event({ type: 'audio_ack', receivedBytes: (i + 1) * 3200 });
    jest.advanceTimersByTime(100);
  }
  expect(h.controller.state).toBe('finalizing');
  h.event({ type: 'final', text: 'long utterance' });
  expect(await result).toBe('long utterance');
});
test.each(['network', 'interrupt', 'queue', 'timeout'])(
  '%s failure rejects instead of executing partial speech',
  async mode => {
    const h = harness();
    const result = h.controller.start();
    const rejected = expect(result).rejects.toThrow();
    await ready(h);
    h.event({ type: 'partial', text: 'dangerous partial' });
    if (mode === 'network') h.ws.onclose?.();
    if (mode === 'interrupt') h.interrupt();
    if (mode === 'queue') {
      h.ws.bufferedAmount = 64001;
      h.frame();
    }
    if (mode === 'timeout') {
      h.controller.finish();
      jest.advanceTimersByTime(5000);
    }
    await rejected;
    expect(h.capture.stop).toHaveBeenCalled();
  },
);
test('stale identities ignored and unsolicited final rejected', async () => {
  const h = harness();
  const result = h.controller.start();
  const rejected = expect(result).rejects.toThrow('Incomplete');
  await ready(h);
  h.event({ type: 'partial', text: 'stale', utteranceId: 'other' });
  expect(h.partial).not.toHaveBeenCalled();
  h.event({ type: 'final', text: 'too early' });
  await rejected;
});

test('native transports without bufferedAmount still enforce two seconds of unacknowledged audio', async () => {
  const h = harness();
  h.ws.bufferedAmount = undefined as unknown as number;
  const result = h.controller.start();
  const failure = result.catch(error => error);
  await ready(h);
  for (let i = 0; i < 21; i++) h.frame();
  expect(await failure).toBeInstanceOf(Error);
  expect((h.ws.send as jest.Mock).mock.calls.filter(c => c[0] instanceof ArrayBuffer)).toHaveLength(20);
  expect(h.capture.stop).toHaveBeenCalled();
});
