import { matchTranslatorCommand } from '@/lib/translatorCommands';

// Voice-only control of translator mode. Whole-utterance matching is the
// point: commands must work in English and Georgian (with "Mia" in front),
// and nothing that is really a sentence to translate may ever be obeyed.

const out = (t: string) => matchTranslatorCommand(t, { inSession: false });
const inn = (t: string) => matchTranslatorCommand(t, { inSession: true });

describe('starting translator mode', () => {
  it.each([
    ['translate', {}],
    ['Start translating', {}],
    ['Mia, be my interpreter', {}],
    ['translation mode please', {}],
    ['turn on the translator', {}],
    ['თარგმნე', {}],
    ['მია, ჩართე თარჯიმანი', {}],
    ['იყავი ჩემი თარჯიმანი', {}],
    ['translate to English', { to: 'en' }],
    ['Translate into French.', { to: 'fr' }],
    ['translate English', { to: 'en' }],
    ['translate from English to Georgian', { from: 'en', to: 'ka' }],
    ['translate English to Georgian', { from: 'en', to: 'ka' }],
    ['თარგმნე ინგლისურად', { to: 'en' }],
    ['მათარგმნინე რუსულად', { to: 'ru' }],
    ['თარგმნე ქართულიდან გერმანულად', { from: 'ka', to: 'de' }],
    ['ინგლისურიდან ქართულზე თარგმნე', { from: 'en', to: 'ka' }],
    ['переведи на английский', { to: 'en' }],
  ])('"%s"', (text, langs) => {
    expect(out(text)).toEqual({ kind: 'start', ...langs });
  });

  it.each([
    'translate good morning into French', // a one-off phrase: the assistant's job
    'როგორ არის ინგლისურად მადლობა?',
    'რა ამინდია დღეს',
    'English', // a bare language means nothing outside a session
    'stop',
    'pause',
    '',
  ])('ignores "%s"', (text) => {
    expect(out(text)).toBeNull();
  });
});

describe('inside a session', () => {
  it.each([
    'stop translating',
    'Stop translation.',
    'Mia, stop translating',
    'exit translator',
    'turn off the translator',
    'შეწყვიტე თარგმნა',
    'თარგმნა შეწყვიტე',
    'მია, გამორთე თარჯიმანი',
    'სტოპ ტრანსლეიტინგ', // English as Georgian STT spells it
    'стоп перевод',
  ])('"%s" stops', (text) => {
    expect(inn(text)).toEqual({ kind: 'stop' });
  });

  it.each([
    ['French', { to: 'fr' }],
    ['to German', { to: 'de' }],
    ['switch to Spanish', { to: 'es' }],
    ['ფრანგულად', { to: 'fr' }],
    ['გადართე რუსულზე', { to: 'ru' }],
    ['from English', { from: 'en' }],
    ['translate to Russian', { to: 'ru' }],
    ['English to Georgian', { from: 'en', to: 'ka' }],
  ])('"%s" changes languages', (text, langs) => {
    expect(inn(text)).toEqual({ kind: 'set', ...langs });
  });

  it.each(['swap', 'swap languages', 'switch languages', 'შეაბრუნე', 'გაცვალე ენები'])(
    '"%s" swaps',
    (text) => {
      expect(inn(text)).toEqual({ kind: 'swap' });
    },
  );

  it.each([
    'stop', // someone being interpreted may well say this
    'please stop the car',
    'შეწყვიტე',
    'I want to stop here',
    'where is the station',
    'გამარჯობა, როგორ ხარ?',
    'English is hard', // a sentence about a language, not a command
  ])('"%s" is translated, not obeyed', (text) => {
    expect(inn(text)).toBeNull();
  });
});
