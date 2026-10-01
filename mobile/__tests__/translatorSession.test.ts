// Translator mode as a service (no screen): hands-free listen → translate →
// speak, voice commands checked before anything is translated, and a mic that
// is always handed back to "Hey Mia" when the translator lets go of it.

jest.mock('react-native-reanimated', () => ({ withTiming: (v: number) => v }));
jest.mock('@/lib/audioLevel', () => ({ audioLevel: { value: 0 } }));
jest.mock('@/orb/micAnalysis', () => ({ analyzeMicFrame: jest.fn() }));
jest.mock('@/lib/storage', () => {
  const m = new Map<string, string>();
  return {
    storage: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
      removeItem: async (k: string) => void m.delete(k),
    },
  };
});

let mockWatch: ((spoke: boolean) => void) | null = null;
jest.mock('@/hooks/useSilenceAutoStop', () => ({
  startSilenceWatch: jest.fn((cb: (spoke: boolean) => void) => {
    mockWatch = cb;
    return jest.fn();
  }),
}));
jest.mock('@/lib/pcmCapture', () => ({
  pcmCapture: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue({ audioBase64: 'AAAA', sampleRate: 16000 }),
    reset: jest.fn(),
  },
  rmsLevel: () => 0,
}));
jest.mock('@/api/transcribeGoogle', () => ({ transcribeGooglePcm: jest.fn() }));
jest.mock('@/api/translate', () => ({ translateText: jest.fn() }));
jest.mock('@/api/client', () => ({ expireSessionIf401: jest.fn() }));
jest.mock('@/lib/orbPlayback', () => ({
  orbPlayback: { speak: jest.fn().mockResolvedValue(undefined), stop: jest.fn() },
}));
jest.mock('@/lib/wakeWord', () => ({
  wakeWord: { pauseDetection: jest.fn(), resumeDetection: jest.fn() },
}));
jest.mock('@/hooks/usePermissions', () => ({
  ensureMicrophonePermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/stt/client', () => ({
  streamingEnabled: jest.fn().mockResolvedValue(false),
  streamUrl: () => 'ws://test',
}));
jest.mock('@/stt/expoCapture', () => ({
  expoCapture: () => ({ start: jest.fn().mockResolvedValue(undefined), stop: jest.fn() }),
}));

type FakeController = {
  opts: {
    language: string;
    segment: (t: string) => void;
    partial: (t: string) => void;
    state: (s: string) => void;
  };
  state: string;
  start: jest.Mock;
  cancel: jest.Mock;
  finish: jest.Mock;
  keepListening: jest.Mock;
};
const mockControllers: FakeController[] = [];
jest.mock('@/stt/controller', () => ({
  SttController: jest.fn().mockImplementation((opts) => {
    const c = {
      opts,
      state: 'listening',
      start: jest.fn(() => new Promise(() => {})),
      cancel: jest.fn(),
      finish: jest.fn(),
      keepListening: jest.fn(),
    };
    mockControllers.push(c);
    return c;
  }),
}));

import { AppState, type AppStateStatus } from 'react-native';

import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { translateText } from '@/api/translate';
import { orbPlayback } from '@/lib/orbPlayback';
import { pcmCapture } from '@/lib/pcmCapture';
import { __resetTranslatorForTests, translator } from '@/lib/translator/session';
import { wakeWord } from '@/lib/wakeWord';
import { useTranslatorSession } from '@/stores/translatorSessionStore';
import { useTranslatorStore } from '@/stores/translatorStore';
import { streamingEnabled } from '@/stt/client';

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
const session = () => useTranslatorSession.getState();

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

beforeEach(() => {
  __resetTranslatorForTests();
  jest.clearAllMocks();
  mockControllers.length = 0;
  mockWatch = null;
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, h) => {
    appStateHandler = h as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  useTranslatorStore.setState({ direction: { from: 'ka', to: 'en' }, autoSpeak: true });
  (streamingEnabled as jest.Mock).mockResolvedValue(false);
  (translateText as jest.Mock).mockImplementation(async (t: string) => `[${t}]`);
});

describe('record → translate path', () => {
  test('starts in the requested direction, translates, speaks, listens again', async () => {
    (transcribeGooglePcm as jest.Mock).mockResolvedValue('გამარჯობა');
    await translator.start({ to: 'fr' });
    await flush();

    expect(session().active).toBe(true);
    expect(session().phase).toBe('listening');
    expect(useTranslatorStore.getState().direction).toEqual({ from: 'ka', to: 'fr' });
    expect(wakeWord.pauseDetection).toHaveBeenCalled();

    mockWatch!(true);
    await flush();

    expect(transcribeGooglePcm).toHaveBeenCalledWith('AAAA', 16000, ['ka-GE']);
    expect(translateText).toHaveBeenCalledWith('გამარჯობა', 'ka', 'fr');
    expect(session().turns).toEqual([
      expect.objectContaining({
        heard: 'გამარჯობა',
        translated: '[გამარჯობა]',
        pending: false,
        source: 'ka',
        target: 'fr',
      }),
    ]);
    expect(orbPlayback.speak).toHaveBeenCalledWith('[გამარჯობა]');
    expect(pcmCapture.start).toHaveBeenCalledTimes(2); // listening again
  });

  test('"stop translating" is obeyed, never translated, and frees the mic', async () => {
    (transcribeGooglePcm as jest.Mock).mockResolvedValue('შეწყვიტე თარგმნა');
    await translator.start();
    await flush();
    mockWatch!(true);
    await flush();

    expect(translateText).not.toHaveBeenCalled();
    expect(session().active).toBe(false);
    expect(session().phase).toBe('off');
    expect(wakeWord.resumeDetection).toHaveBeenCalled();
    expect(pcmCapture.start).toHaveBeenCalledTimes(1);
  });

  test('long silence closes the mic but keeps the view', async () => {
    await translator.start();
    for (let i = 0; i < 5; i++) {
      await flush();
      mockWatch!(false);
    }
    await flush();
    expect(session().active).toBe(true);
    expect(session().phase).toBe('paused');
    expect(transcribeGooglePcm).not.toHaveBeenCalled();
  });
});

describe('live (streaming) path', () => {
  beforeEach(() => {
    (streamingEnabled as jest.Mock).mockResolvedValue(true);
  });

  test('each sentence translates and speaks; the mic stays muted meanwhile', async () => {
    await translator.start();
    await flush();
    const c = mockControllers[0];
    expect(c.opts.language).toBe('ka');

    c.opts.state('listening');
    c.opts.segment('როგორ ხარ');
    expect(session().turns[0]).toEqual(
      expect.objectContaining({ heard: 'როგორ ხარ', pending: true }),
    );
    await flush();
    expect(session().turns[0]).toEqual(
      expect.objectContaining({ translated: '[როგორ ხარ]', pending: false }),
    );
    expect(orbPlayback.speak).toHaveBeenCalledWith('[როგორ ხარ]');
  });

  test('a stop command mid-session ends it without translating', async () => {
    await translator.start();
    await flush();
    mockControllers[0].opts.segment('stop translating');
    await flush();
    expect(translateText).not.toHaveBeenCalled();
    expect(session().active).toBe(false);
    expect(mockControllers[0].cancel).toHaveBeenCalled();
    expect(wakeWord.resumeDetection).toHaveBeenCalled();
  });

  test('naming a language switches the target and restarts listening', async () => {
    await translator.start();
    await flush();
    mockControllers[0].opts.segment('ფრანგულად');
    await flush();
    expect(translateText).not.toHaveBeenCalled();
    expect(useTranslatorStore.getState().direction).toEqual({ from: 'ka', to: 'fr' });
    expect(mockControllers[0].cancel).toHaveBeenCalled();
    expect(mockControllers).toHaveLength(2);
    expect(session().active).toBe(true);
  });

  test('changing the spoken language restarts recognition in it', async () => {
    await translator.start();
    await flush();
    translator.swap();
    await flush();
    expect(useTranslatorStore.getState().direction).toEqual({ from: 'en', to: 'ka' });
    expect(mockControllers.at(-1)!.opts.language).toBe('en');
  });
});

describe('control', () => {
  test('the orb tap pauses and resumes', async () => {
    await translator.start();
    await flush();
    translator.toggleListening();
    expect(session().phase).toBe('paused');
    expect(pcmCapture.reset).toHaveBeenCalled();
    translator.toggleListening();
    await flush();
    expect(session().phase).toBe('listening');
  });

  test('leaving the app pauses the mic', async () => {
    await translator.start();
    await flush();
    appStateHandler!('background');
    expect(session().phase).toBe('paused');
    expect(session().active).toBe(true);
  });

  test('close (×) returns to chat and silences playback', async () => {
    await translator.start();
    await flush();
    translator.stop();
    expect(session()).toEqual(expect.objectContaining({ active: false, phase: 'off' }));
    expect(orbPlayback.stop).toHaveBeenCalled();
  });

  test('typed text pauses the mic and becomes a turn', async () => {
    await translator.start();
    await flush();
    await expect(translator.translateTyped('hello')).resolves.toBe(true);
    expect(session().phase).toBe('paused');
    expect(session().turns.at(-1)).toEqual(
      expect.objectContaining({ heard: 'hello', translated: '[hello]' }),
    );
  });

  test('a failed translation is shown as failed, the session carries on', async () => {
    (translateText as jest.Mock).mockRejectedValue(new Error('Translate 500: x'));
    (transcribeGooglePcm as jest.Mock).mockResolvedValue('გამარჯობა');
    await translator.start();
    await flush();
    mockWatch!(true);
    await flush();
    expect(session().turns[0]).toEqual(expect.objectContaining({ failed: true }));
    expect(session().error).toBe('Translate 500: x');
    expect(session().active).toBe(true);
    expect(pcmCapture.start).toHaveBeenCalledTimes(2);
  });
});
