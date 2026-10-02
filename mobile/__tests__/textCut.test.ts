import { safeCut } from '@/lib/textCut';

// The streaming reveal cuts text at arbitrary positions; a cut inside a
// surrogate pair would flash half an emoji.

describe('safeCut', () => {
  it('leaves ordinary positions alone (Georgian, Latin)', () => {
    expect(safeCut('გამარჯობა', 4)).toBe(4);
    expect(safeCut('hello', 2)).toBe(2);
  });

  it('never splits a surrogate pair', () => {
    const t = 'ok 👍 yes';
    const mid = t.indexOf('👍') + 1; // between the two halves
    expect(safeCut(t, mid)).toBe(mid + 1);
    expect(t.slice(0, safeCut(t, mid))).toBe('ok 👍');
  });

  it('clamps to the text', () => {
    expect(safeCut('abc', -3)).toBe(0);
    expect(safeCut('abc', 99)).toBe(3);
    expect(safeCut('abc', 1.7)).toBe(1);
  });
});
