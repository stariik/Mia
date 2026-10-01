import type { Capture } from './controller';

/** Stateful area resampler: keeps fractional sample area across native callbacks.
 * Channels are averaged, not discarded. No normalization or silence trimming.
 */
export class PcmPacketizer {
  private rate = 0;
  private channels = 0;
  private area = 0;
  private weight = 0;
  private packet: number[] = [];
  constructor(private emit: (packet: ArrayBuffer) => void) {}

  push(data: ArrayBuffer, rate: number, channels: number) {
    if (
      !Number.isInteger(rate) ||
      rate < 16000 ||
      rate > 192000 ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 8 ||
      data.byteLength % (2 * channels)
    ) {
      throw new Error('Unsupported microphone format');
    }
    if (this.rate && (this.rate !== rate || this.channels !== channels)) {
      throw new Error('Audio route changed. Please start again.');
    }
    this.rate = rate;
    this.channels = channels;
    const view = new DataView(data);
    const ratio = rate / 16000;
    for (let i = 0; i < data.byteLength; i += channels * 2) {
      let mono = 0;
      for (let c = 0; c < channels; c++)
        mono += view.getInt16(i + c * 2, true) / channels;
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, ratio - this.weight);
        this.area += mono * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= ratio - 1e-9) {
          this.packet.push(Math.round(this.area / this.weight));
          this.area = this.weight = 0;
          if (this.packet.length === 1600) this.send();
        }
      }
    }
  }
  flush() {
    if (this.weight) this.packet.push(Math.round(this.area / this.weight));
    this.area = this.weight = 0;
    if (this.packet.length) this.send();
  }
  private send() {
    const result = new ArrayBuffer(this.packet.length * 2);
    const view = new DataView(result);
    this.packet.forEach((v, i) =>
      view.setInt16(i * 2, Math.max(-32768, Math.min(32767, v)), true),
    );
    this.packet = [];
    this.emit(result);
  }
}

/** Feeds silence instead of the mic while muted (e.g. while a translation is
 * spoken), so the recognizer never transcribes our own voice. Frames keep
 * flowing, so the client and gateway stall checks stay quiet. */
export function mutedCapture(capture: Capture) {
  let muted = false;
  return {
    start: (
      frame: (data: ArrayBuffer, rate: number, channels: number) => void,
      interrupted: () => void,
    ) =>
      capture.start(
        (data, rate, channels) =>
          frame(muted ? new ArrayBuffer(data.byteLength) : data, rate, channels),
        interrupted,
      ),
    stop: () => capture.stop(),
    setMuted(on: boolean) {
      muted = on;
    },
  };
}
