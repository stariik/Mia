import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editDistance,
  evaluate,
  type Recording,
  type Result,
} from './evaluation';
test('WER counts substitutions, insertions and deletions', () => {
  assert.equal(editDistance(['ერთი', 'ორი', 'სამი'], ['ერთი', 'ოთხი']), 2);
  assert.equal(editDistance([], ['noise']), 1);
});
test('missing human/device evidence never passes', () => {
  const result = evaluate([], []);
  assert.equal(result.selected, 'legacy');
  assert.equal(result.datasetComplete, false);
  assert.equal(result.devicesPass, false);
});
test('heldout scoring ignores tuning results, penalizes silence hallucinations and checks audio identity', () => {
  const recording: Recording = {
    id: 'one',
    device: 'android',
    file: 'one.wav',
    humanRecorded: true,
    split: 'heldout',
    condition: 'quiet',
    reference: 'ერთი ორი',
    critical: ['ორი'],
    speechStartMs: 0,
    speechEndMs: 2000,
  };
  const result: Result = {
    id: 'one',
    provider: 'elevenlabs',
    audioSha256: 'hash',
    text: 'ერთი სამი',
    firstPartialMs: 300,
    finalLatencyMs: 1500,
    capturedThroughSpeechEnd: true,
    actualBilledUsd: null,
  };
  const score = evaluate([recording], [result]);
  assert.equal(score.rows[1].wer, 0.5);
  assert.equal(score.rows[1].criticalAccuracy, 0);
  assert.equal(score.sameAudio, false);
  const silence = evaluate(
    [{ ...recording, reference: '', critical: [], condition: 'silence' }],
    [result],
  );
  assert.equal(silence.rows[1].behaviorPass, false);
});
