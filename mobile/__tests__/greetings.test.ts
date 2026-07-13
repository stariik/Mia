import { isGoodbye } from '@/lib/greetings';

describe('isGoodbye', () => {
  test('detects explicit goodbyes', () => {
    expect(isGoodbye('ნახვამდის')).toBe(true);
    expect(isGoodbye('კარგი, კმარა')).toBe(true);
    expect(isGoodbye('მშვიდობით!')).toBe(true);
  });

  test('detects English and Russian goodbyes', () => {
    expect(isGoodbye('Goodbye')).toBe(true);
    expect(isGoodbye('ok bye!')).toBe(true);
    expect(isGoodbye('see you later')).toBe(true);
    expect(isGoodbye('До свидания')).toBe(true);
    expect(isGoodbye('пока')).toBe(true);
  });

  test('ignores ambiguous non-goodbyes', () => {
    expect(isGoodbye('пока не знаю')).toBe(false); // "I don't know yet"
    expect(isGoodbye('maybe later')).toBe(false);
  });

  test('ignores bare "კარგად" and ordinary speech', () => {
    expect(isGoodbye('კარგად')).toBe(false);
    expect(isGoodbye('კარგად.')).toBe(false);
    expect(isGoodbye('რომელი საათია?')).toBe(false);
    expect(isGoodbye('')).toBe(false);
  });
});
