import test from 'node:test';
import assert from 'node:assert/strict';
import { gainPacket } from './gain';

const sine = (amplitude: number) => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++)
    b.writeInt16LE(Math.round(amplitude * Math.sin(i / 5)), i * 2);
  return b;
};
const rms = (b: Buffer) => {
  let s = 0;
  for (let i = 0; i < b.length; i += 2) s += b.readInt16LE(i) ** 2;
  return Math.sqrt(s / (b.length / 2));
};

test('quiet speech is boosted toward -20 dBFS, loud speech untouched, never clips', () => {
  const quiet = sine(260); // ~-45 dBFS RMS, like iPhone measurement-mode input
  const boosted = gainPacket({ loudest: 0 }, quiet);
  assert.ok(rms(boosted) > 2500 && rms(boosted) < 3400);

  const loud = sine(12000);
  assert.equal(gainPacket({ loudest: 0 }, loud), loud);

  const spiky = sine(260);
  spiky.writeInt16LE(2000, 100); // a click that would clip at full gain
  const out = gainPacket({ loudest: 0 }, spiky);
  for (let i = 0; i < out.length; i += 2)
    assert.ok(Math.abs(out.readInt16LE(i)) <= 32767 * 0.9 + 1);
});

test('gain follows the loudest packet so far: silence after speech is not pumped up', () => {
  const state = { loudest: 0 };
  gainPacket(state, sine(3000));
  const noise = sine(10);
  assert.ok(rms(gainPacket(state, noise)) < rms(noise) * 2);
  // Silence-only input is capped at +24 dB.
  assert.ok(rms(gainPacket({ loudest: 0 }, noise)) <= rms(noise) * 16 + 1);
});
