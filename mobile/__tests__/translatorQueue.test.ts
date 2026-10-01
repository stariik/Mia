import {
  parkTranslatorForForeground,
  takeTranslatorFromBackground,
} from '@/lib/translator/queue';

// "Hey Mia, translate…" with the app closed parks the request for the home
// screen. It must be picked up once, and only while it is still fresh.

describe('translator hand-off from the background session', () => {
  afterEach(() => jest.useRealTimers());

  it('is taken exactly once', () => {
    parkTranslatorForForeground({ to: 'en' });
    expect(takeTranslatorFromBackground()).toEqual({ to: 'en' });
    expect(takeTranslatorFromBackground()).toBeNull();
  });

  it('expires, so a later app open does not start interpreting', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    parkTranslatorForForeground({ to: 'fr' });
    jest.setSystemTime(1_000_000 + 31_000);
    expect(takeTranslatorFromBackground()).toBeNull();
  });
});
