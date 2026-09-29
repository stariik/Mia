import {
  DEFAULT_DIRECTION,
  TRANSLATOR_LANGS,
  languageNameKaAdverb,
  sanitizeDirection,
  swapDirection,
  withFrom,
  withTo,
} from '@/lib/translateLanguages';

// Any two supported languages can be paired, but never a language with itself —
// that would send STT/translate a no-op direction the screen can't explain.

describe('translator direction', () => {
  it('lists Georgian first', () => {
    expect(TRANSLATOR_LANGS[0]).toBe('ka');
  });

  it('swap flips from and to', () => {
    expect(swapDirection({ from: 'ka', to: 'ru' })).toEqual({ from: 'ru', to: 'ka' });
    expect(swapDirection({ from: 'fr', to: 'de' })).toEqual({ from: 'de', to: 'fr' });
  });

  it('withFrom / withTo change one side', () => {
    expect(withFrom({ from: 'ka', to: 'ru' }, 'fr')).toEqual({ from: 'fr', to: 'ru' });
    expect(withTo({ from: 'ka', to: 'ru' }, 'es')).toEqual({ from: 'ka', to: 'es' });
    expect(withTo({ from: 'en', to: 'ka' }, 'de')).toEqual({ from: 'en', to: 'de' });
  });

  it('picking the other side\'s language swaps instead of pairing it with itself', () => {
    expect(withFrom({ from: 'ka', to: 'ru' }, 'ru')).toEqual({ from: 'ru', to: 'ka' });
    expect(withTo({ from: 'de', to: 'en' }, 'de')).toEqual({ from: 'en', to: 'de' });
  });

  it('sanitizeDirection accepts any pair of different languages', () => {
    expect(sanitizeDirection({ from: 'ka', to: 'ru' })).toEqual({ from: 'ka', to: 'ru' });
    expect(sanitizeDirection({ from: 'en', to: 'ka' })).toEqual({ from: 'en', to: 'ka' });
    expect(sanitizeDirection({ from: 'ru', to: 'fr' })).toEqual({ from: 'ru', to: 'fr' });
    expect(sanitizeDirection({ from: 'es', to: 'de' })).toEqual({ from: 'es', to: 'de' });
  });

  it.each([
    undefined,
    null,
    'ka',
    {},
    { from: 'ka', to: 'ka' },
    { from: 'fr', to: 'fr' },
    { from: 'ka', to: 'tr' },
    { from: 'it', to: 'ka' },
  ])('sanitizeDirection falls back to the default for %p', (bad) => {
    expect(sanitizeDirection(bad)).toEqual(DEFAULT_DIRECTION);
  });

  it('adverb names read naturally in prompts', () => {
    expect(languageNameKaAdverb('ka')).toBe('ქართულად');
    expect(languageNameKaAdverb('ru')).toBe('რუსულად');
    expect(languageNameKaAdverb('en')).toBe('ინგლისურად');
    expect(languageNameKaAdverb('de')).toBe('გერმანულად');
    expect(languageNameKaAdverb('fr')).toBe('ფრანგულად');
    expect(languageNameKaAdverb('es')).toBe('ესპანურად');
  });
});
