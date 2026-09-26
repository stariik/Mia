export type Recording = {
  id: string;
  file: string;
  humanRecorded: boolean;
  device: 'android' | 'iphone';
  split: 'tune' | 'heldout';
  condition: 'quiet' | 'noise' | 'silence';
  reference: string;
  critical: string[];
  speechStartMs: number | null;
  speechEndMs: number | null;
  keepListening?: boolean;
};
export type Result = {
  id: string;
  provider: string;
  audioSha256: string;
  text: string;
  error?: string;
  firstPartialMs: number | null;
  finalLatencyMs: number | null;
  capturedThroughSpeechEnd: boolean;
  actualBilledUsd: number | null;
};
const words = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase('ka')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
export function editDistance(reference: string[], hypothesis: string[]) {
  let row = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 0; i < reference.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < hypothesis.length; j++)
      next.push(
        Math.min(
          next[j] + 1,
          row[j + 1] + 1,
          row[j] + Number(reference[i] !== hypothesis[j]),
        ),
      );
    row = next;
  }
  return row[hypothesis.length];
}
const percentile95 = (values: number[]) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
    : null;
export function evaluate(
  recordings: Recording[],
  results: Result[],
  deviceGates: Record<string, boolean> = {},
) {
  const heldout = recordings.filter((r) => r.split === 'heldout');
  const speech = heldout.filter((r) => r.condition !== 'silence');
  const rows = ['legacy', 'elevenlabs', 'google'].map((provider) => {
    const pairs = heldout.map((r) => ({
      recording: r,
      result: results
        .filter((x) => x.id === r.id && x.provider === provider)
        .at(-1),
    }));
    const wer = (condition?: string) => {
      let errors = 0,
        count = 0;
      for (const { recording: r, result } of pairs) {
        if (
          r.condition === 'silence' ||
          (condition && r.condition !== condition)
        )
          continue;
        const ref = words(r.reference);
        count += ref.length;
        errors += editDistance(ref, words(result?.text ?? ''));
      }
      return count ? errors / count : null;
    };
    const missing = pairs.some((p) => !p.result);
    const critical = pairs.flatMap(({ recording: r, result }) =>
      r.critical.map((term) =>
        ` ${words(result?.text ?? '').join(' ')} `.includes(
          ` ${words(term).join(' ')} `,
        ),
      ),
    );
    const first = pairs
      .filter((p) => p.recording.condition !== 'silence')
      .map((p) => p.result?.firstPartialMs)
      .filter((n): n is number => typeof n === 'number');
    const final = pairs
      .filter((p) => p.recording.condition !== 'silence')
      .map((p) => p.result?.finalLatencyMs)
      .filter((n): n is number => typeof n === 'number');
    const firstP95 = percentile95(first),
      finalP95 = percentile95(final);
    return {
      provider,
      missing,
      wer: wer(),
      quietWer: wer('quiet'),
      noiseWer: wer('noise'),
      criticalAccuracy: critical.length
        ? critical.filter(Boolean).length / critical.length
        : null,
      firstPartialP95Ms: firstP95,
      finalP95Ms: finalP95,
      latencyPass:
        first.length === speech.length &&
        final.length === speech.length &&
        firstP95 !== null &&
        firstP95 >= 0 &&
        firstP95 <= 1000 &&
        finalP95 !== null &&
        finalP95 >= 0 &&
        finalP95 <= 2500,
      behaviorPass: pairs.every(
        (p) =>
          p.result &&
          (p.recording.condition === 'silence'
            ? !p.result.text.trim() && p.result.error === 'no_speech'
            : !p.result.error && p.result.capturedThroughSpeechEnd),
      ),
      billedUsd: pairs.every((p) => p.result?.actualBilledUsd != null)
        ? pairs.reduce((n, p) => n + p.result!.actualBilledUsd!, 0)
        : null,
    };
  });
  const legacy = rows[0];
  const datasetComplete =
    speech.length >= 30 &&
    recordings.filter((r) => r.split === 'tune' && r.condition !== 'silence')
      .length >= 30 &&
    recordings.every((r) => r.humanRecorded) &&
    ['android', 'iphone'].every(
      (d) =>
        heldout.some((r) => r.device === d && r.condition === 'silence') &&
        speech.some((r) => r.device === d),
    );
  const requiredGates = [
    'androidExpoGo',
    'iphoneExpoGo',
    'permissions',
    'calls',
    'headphones',
    'background',
    'networkLoss',
    'noLostAudio',
    'longUtterance',
    'noDuplicateCommands',
    'noPostCancelCommands',
  ];
  const devicesPass = requiredGates.every((g) => deviceGates[g] === true);
  const sameAudio = heldout.every((r) => {
    const hashes = rows.map(
      (p) =>
        results.filter((x) => x.id === r.id && x.provider === p.provider).at(-1)
          ?.audioSha256,
    );
    return hashes.every((h) => h && h === hashes[0]);
  });
  const passing = rows
    .slice(1)
    .filter(
      (r) =>
        datasetComplete &&
        devicesPass &&
        sameAudio &&
        !r.missing &&
        !legacy.missing &&
        r.quietWer !== null &&
        r.quietWer <= 0.1 &&
        r.noiseWer !== null &&
        r.noiseWer <= 0.2 &&
        r.wer! <= legacy.wer! &&
        r.criticalAccuracy !== null &&
        r.criticalAccuracy >= 0.95 &&
        r.latencyPass &&
        r.behaviorPass,
    );
  passing.sort((a, b) =>
    Math.abs(a.wer! - b.wer!) > 0.01
      ? a.wer! - b.wer!
      : a.finalP95Ms! - b.finalP95Ms! ||
        (a.billedUsd ?? Infinity) - (b.billedUsd ?? Infinity),
  );
  return {
    datasetComplete,
    devicesPass,
    sameAudio,
    rows,
    selected: passing[0]?.provider ?? 'legacy',
    decision: passing.length
      ? 'Candidate passed recorded gates; enable rollout manually.'
      : 'Retain existing default; missing or failed gates.',
  };
}
