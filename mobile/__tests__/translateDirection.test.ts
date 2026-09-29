import {
  DEFAULT_DIRECTION,
  foreignOf,
  languageNameKaAdverb,
  sanitizeDirection,
  swapDirection,
  withForeign,
} from '@/lib/translateLanguages';

// The Translator always pairs Georgian with one foreign language. These guard
// the invariant that no helper ever produces a pair without Georgian on one
// side — that would send STT/translate a direction the screen can't show.

describe('translator direction', () => {
  it('swap flips from and to', () => {
    expect(swapDirection({ from: 'ka', to: 'ru' })).toEqual({ from: 'ru', to: 'ka' });
    expect(swapDirection({ from: 'en', to: 'ka' })).toEqual({ from: 'ka', to: 'en' });
  });

  it('foreignOf returns the non-Georgian side', () => {
    expect(foreignOf({ from: 'ka', to: 'en' })).toBe('en');
    expect(foreignOf({ from: 'ru', to: 'ka' })).toBe('ru');
  });

  it('withForeign keeps Georgian on its side', () => {
    expect(withForeign({ from: 'ka', to: 'ru' }, 'en')).toEqual({ from: 'ka', to: 'en' });
    expect(withForeign({ from: 'ru', to: 'ka' }, 'en')).toEqual({ from: 'en', to: 'ka' });
    expect(withForeign({ from: 'ka', to: 'en' }, 'es')).toEqual({ from: 'ka', to: 'es' });
    expect(withForeign({ from: 'de', to: 'ka' }, 'fr')).toEqual({ from: 'fr', to: 'ka' });
  });

  it('sanitizeDirection accepts valid pairs', () => {
    expect(sanitizeDirection({ from: 'en', to: 'ka' })).toEqual({ from: 'en', to: 'ka' });
    expect(sanitizeDirection({ from: 'ka', to: 'ru' })).toEqual({ from: 'ka', to: 'ru' });
    expect(sanitizeDirection({ from: 'ka', to: 'de' })).toEqual({ from: 'ka', to: 'de' });
    expect(sanitizeDirection({ from: 'fr', to: 'ka' })).toEqual({ from: 'fr', to: 'ka' });
    expect(sanitizeDirection({ from: 'es', to: 'ka' })).toEqual({ from: 'es', to: 'ka' });
  });

  it.each([
    undefined,
    null,
    'ka',
    {},
    { from: 'ka', to: 'ka' },
    { from: 'ru', to: 'en' },
    { from: 'ka', to: 'tr' },
    { from: 'it', to: 'ka' },
    { from: 'de', to: 'fr' },
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
