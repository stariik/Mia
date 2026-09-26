import type {
  ClientMessage,
  Identity,
  ServerMessage,
} from '../../../web/src/stt/protocol';
import { PcmPacketizer } from './audio';

export type ListeningState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'finalizing'
  | 'error';
export interface Capture {
  start(
    frame: (data: ArrayBuffer, rate: number, channels: number) => void,
    interrupted: () => void,
  ): Promise<void>;
  stop(): void;
}
export interface Socket {
  readyState: number;
  bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}
type Options = {
  capture: Capture;
  socket: () => Socket;
  identity: Identity;
  token: string;
  state: (state: ListeningState) => void;
  partial: (text: string) => void;
  elapsed: (seconds: number) => void;
};

/** Single-use owner. Cancellation invalidates every asynchronous callback before cleanup. */
export class SttController {
  state: ListeningState = 'idle';
  private socket?: Socket;
  private packetizer: PcmPacketizer;
  private closed = false;
  private started = false;
  private auto = true;
  private ready = false;
  private bytes = 0;
  private sentBytes = 0;
  private acknowledgedBytes = 0;
  private lastFrame = 0;
  private startAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private tick?: ReturnType<typeof setInterval>;
  private resolve!: (text: string | null) => void;
  private reject!: (error: Error) => void;
  constructor(private options: Options) {
    this.packetizer = new PcmPacketizer(packet => this.audio(packet));
  }
  start(): Promise<string | null> {
    if (this.started)
      return Promise.reject(new Error('This utterance has already started'));
    this.started = true;
    const result = new Promise<string | null>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    if (this.closed) {
      this.resolve(null);
      return result;
    }
    this.setState('connecting');
    this.timer = setTimeout(
      () =>
        this.fail('Connection timed out. Check your connection and try again.'),
      5000,
    );
    try {
      const ws = this.options.socket();
      this.socket = ws;
      ws.onopen = () => {
        if (this.closed) return;
        this.control({
          ...this.options.identity,
          type: 'start',
          version: 1,
          token: this.options.token,
          sampleRate: 16000,
          channels: 1,
          encoding: 'pcm16',
        });
      };
      ws.onmessage = event => {
        if (this.closed) return;
        try {
          this.receive(JSON.parse(event.data));
        } catch {
          this.fail('Invalid speech service response. Please try again.');
        }
      };
      ws.onerror = ws.onclose = () =>
        this.fail('Connection lost. Please start again.');
    } catch {
      this.fail('Unable to connect to speech service.');
    }
    return result;
  }
  private receive(event: ServerMessage) {
    if (
      event.sessionId !== this.options.identity.sessionId ||
      event.utteranceId !== this.options.identity.utteranceId
    )
      return;
    if (event.type === 'error') {
      this.fail(event.message);
      return;
    }
    if (event.type === 'audio_ack') {
      if (
        !Number.isInteger(event.receivedBytes) ||
        event.receivedBytes < this.acknowledgedBytes ||
        event.receivedBytes > this.sentBytes
      ) {
        this.fail('Invalid audio acknowledgement. Please try again.');
        return;
      }
      this.acknowledgedBytes = event.receivedBytes;
      return;
    }
    if (event.type === 'ready' && this.state === 'connecting' && !this.ready) {
      this.ready = true;
      void this.beginCapture();
    } else if (event.type === 'partial' && typeof event.text === 'string')
      this.options.partial(event.text);
    else if (event.type === 'endpoint' && this.auto) this.finish();
    else if (event.type === 'final') {
      if (
        this.state !== 'finalizing' ||
        typeof event.text !== 'string' ||
        !event.text.trim()
      ) {
        this.fail('Incomplete speech result. Please try again.');
        return;
      }
      this.cleanup();
      this.setState('idle');
      this.resolve(event.text);
    }
  }
  private async beginCapture() {
    try {
      await this.options.capture.start(
        (data, rate, channels) => {
          if (this.closed || !['connecting', 'listening'].includes(this.state))
            return;
          this.lastFrame = Date.now();
          try {
            this.packetizer.push(data, rate, channels);
          } catch (error) {
            this.fail((error as Error).message);
          }
        },
        () => this.fail('Microphone interrupted. Please start again.'),
      );
      if (this.closed) {
        this.options.capture.stop();
        return;
      }
      clearTimeout(this.timer);
      this.startAt = this.lastFrame = Date.now();
      this.setState('listening');
      this.tick = setInterval(() => {
        const elapsed = Date.now() - this.startAt;
        this.options.elapsed(Math.min(60, Math.floor(elapsed / 1000)));
        if (Date.now() - this.lastFrame > 2000) {
          this.fail('Microphone stopped. Please start again.');
          return;
        }
        if ((this.socket?.bufferedAmount ?? 0) > 64000) {
          this.fail('Connection stalled. Check your network and try again.');
          return;
        }
        if (elapsed >= 60000) this.finish();
      }, 100);
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : 'Microphone unavailable.',
      );
    }
  }
  keepListening() {
    if (this.closed || this.state !== 'listening' || !this.auto) return;
    this.auto = false;
    this.control({ ...this.options.identity, type: 'keep_listening' });
  }
  finish() {
    if (this.closed || this.state !== 'listening') return;
    // Stop before flushing; every already delivered sample, including the short tail, is sent.
    this.setState('finalizing');
    clearInterval(this.tick);
    try {
      this.options.capture.stop();
      this.packetizer.flush();
      if (this.closed) return;
      this.control({ ...this.options.identity, type: 'finish' });
      if (!this.closed)
        this.timer = setTimeout(
          () => this.fail('Transcription took too long. Please try again.'),
          5000,
        );
    } catch {
      this.fail('Could not finish recording. Please try again.');
    }
  }
  cancel() {
    if (this.closed) return;
    if (this.socket?.readyState === 1) {
      try {
        this.socket.send(
          JSON.stringify({ ...this.options.identity, type: 'cancel' }),
        );
      } catch {}
    }
    this.cleanup();
    this.setState('idle');
    this.resolve?.(null);
  }
  private audio(packet: ArrayBuffer) {
    if (this.closed) return;
    this.bytes += packet.byteLength;
    // Finish on the exact sample boundary even if native callbacks run ahead of JS timers.
    const extra = Math.max(0, this.bytes - 1920000);
    const send = extra
      ? packet.slice(0, Math.max(0, packet.byteLength - extra))
      : packet;
    const ws = this.socket;
    // RN declares bufferedAmount but does not update it. Explicit acknowledgements
    // bound audio still queued in the native transport as well as JS/browser queues.
    if (
      !ws ||
      ws.readyState !== 1 ||
      (ws.bufferedAmount ?? 0) + send.byteLength > 64000 ||
      this.sentBytes - this.acknowledgedBytes + send.byteLength > 64000
    ) {
      this.fail('Connection stalled. Check your network and try again.');
      return;
    }
    try {
      if (send.byteLength) {
        this.sentBytes += send.byteLength;
        ws.send(send);
      }
    } catch {
      this.fail('Connection lost. Please start again.');
      return;
    }
    if (this.bytes >= 1920000 && this.state === 'listening') this.finish();
  }
  private control(message: ClientMessage) {
    try {
      this.socket!.send(JSON.stringify(message));
    } catch {
      this.fail('Connection lost. Please start again.');
    }
  }
  private fail(message: string) {
    if (this.closed) return;
    this.cleanup();
    this.setState('error');
    this.reject?.(new Error(message));
  }
  private cleanup() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.tick);
    try {
      this.options.capture.stop();
    } catch {}
    if (this.socket) {
      this.socket.onopen =
        this.socket.onmessage =
        this.socket.onerror =
        this.socket.onclose =
          null;
      try {
        this.socket.close();
      } catch {}
    }
  }
  private setState(state: ListeningState) {
    this.state = state;
    this.options.state(state);
  }
}
