// Covers the hands-free conversation loop: one tap opens a session, the mic
// re-arms itself after every clean answer, and anything else (a tap, an error,
// an empty turn) closes it. The re-arm is the part worth pinning — a regression
// there is either "Mia stops listening after one question" or a mic that never
// turns off.

// `mock`-prefixed so jest's hoisting of the factory below can reference it.
const mockRecorder = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest
    .fn()
    .mockResolvedValue({ audioBase64: 'AAAA', sampleRate: 16000 }),
};
jest.mock('@/hooks/usePcmRecorder', () => ({
  usePcmRecorder: () => mockRecorder,
}));

jest.mock('@/api/transcribeGoogle', () => ({
  transcribeGooglePcm: jest.fn().mockResolvedValue('რა ამინდია'),
}));

jest.mock('@/lib/assistantTurn', () => ({
  runAssistantTurn: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/orbPlayback', () => ({
  orbPlayback: { speak: jest.fn().mockResolvedValue(undefined), stop: jest.fn() },
}));

jest.mock('@/lib/wakeWord', () => ({
  wakeWord: { pauseDetection: jest.fn(), resumeDetection: jest.fn() },
}));

jest.mock('@/api/client', () => ({ expireSessionIf401: jest.fn() }));
jest.mock('@/stt/client', () => ({ streamingEnabled: jest.fn().mockResolvedValue(false), streamUrl: () => 'ws://test/api/stt/stream' }));
jest.mock('@/stt/expoCapture', () => ({ expoCapture: jest.fn() }));
jest.mock('@/hooks/usePermissions', () => ({ ensureMicrophonePermission: jest.fn().mockResolvedValue(true) }));

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { useVoicePipeline } from '@/hooks/useVoicePipeline';
import { runAssistantTurn } from '@/lib/assistantTurn';
import { useVoiceStore } from '@/stores/voiceStore';
import { streamingEnabled } from '@/stt/client';
import { expoCapture } from '@/stt/expoCapture';
import { ensureMicrophonePermission } from '@/hooks/usePermissions';
import type { Socket } from '@/stt/controller';

describe('streaming foreground integration', () => {
  let originalSocket: typeof WebSocket;
  let sockets: Socket[];
  const capture = { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn() };
  beforeEach(() => {
    originalSocket = globalThis.WebSocket; sockets = [];
    globalThis.WebSocket = jest.fn(() => {
      const socket: Socket = { readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send: jest.fn(), close: jest.fn() };
      sockets.push(socket); return socket;
    }) as unknown as typeof WebSocket;
    (streamingEnabled as jest.Mock).mockResolvedValue(true);
    (expoCapture as jest.Mock).mockReturnValue(capture);
  });
  afterEach(() => { globalThis.WebSocket = originalSocket; });
  async function ready() {
    const ws = sockets.at(-1)!;
    await act(async () => {
      ws.onopen?.();
      const start = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
      ws.onmessage?.({ data: JSON.stringify({ ...start, type: 'ready' }) });
    });
    const start = JSON.parse((ws.send as jest.Mock).mock.calls[0][0]);
    return { ws, message: (event: object) => ws.onmessage?.({ data: JSON.stringify({ ...start, ...event }) }) };
  }
  test('only final text enters assistant once and successful answer re-arms', async () => {
    const p = await mountPipeline(); await act(async () => { await p.startListening(); });
    const c = await ready();
    await act(async () => { c.message({ type: 'partial', text: 'partial' }); c.message({ type: 'segment', text: 'segment' }); });
    expect(mockTurn).not.toHaveBeenCalled();
    await act(async () => { await p.stopListeningAndSend(); });
    await act(async () => { c.message({ type: 'final', text: 'complete' }); c.message({ type: 'final', text: 'duplicate' }); });
    expect(mockTurn).toHaveBeenCalledTimes(1); expect(mockTurn.mock.calls[0][0].text).toBe('complete');
    expect(sockets).toHaveLength(2); expect(mockTranscribe).not.toHaveBeenCalled();
    await act(async () => { await p.stopConversation(); });
  });
  test('cancel while finalizing suppresses late results and background releases capture', async () => {
    const p = await mountPipeline(); await act(async () => { await p.startListening(); });
    const c = await ready();
    await act(async () => { await p.stopListeningAndSend(); });
    const late = c.ws.onmessage!;
    await act(async () => { appStateHandler?.('background'); });
    await act(async () => { late({ data: JSON.stringify({ type: 'final', text: 'late' }) }); });
    expect(mockTurn).not.toHaveBeenCalled(); expect(capture.stop).toHaveBeenCalled(); expect(p.isConversationActive()).toBe(false);
  });
  test('permission denial never opens a paid socket', async () => {
    (ensureMicrophonePermission as jest.Mock).mockResolvedValue(false);
    const p = await mountPipeline(); await act(async () => { await p.startListening(); });
    expect(sockets).toHaveLength(0); expect(mockTurn).not.toHaveBeenCalled(); expect(p.isConversationActive()).toBe(false);
  });
  test('late configuration response after stop cannot start capture', async () => {
    let release!: (enabled: boolean) => void;
    (streamingEnabled as jest.Mock).mockImplementation(() => new Promise<boolean>(r => { release = r; }));
    const p = await mountPipeline(); let pending!: Promise<void>;
    await act(async () => { pending = p.startListening(); });
    await act(async () => { await p.stopConversation(); release(true); await pending; });
    expect(sockets).toHaveLength(0); expect(p.isConversationActive()).toBe(false);
  });
});

type Pipeline = ReturnType<typeof useVoicePipeline>;

// Captures the AppState handler the hook registers, so tests can drive
// foreground/background transitions.
let appStateHandler: ((s: AppStateStatus) => void) | null = null;

// The probe never subscribes to the store (the hook reads it via getState), so
// it renders once and the returned callbacks stay valid for the whole test.
async function mountPipeline(): Promise<Pipeline> {
  let api!: Pipeline;
  function Probe() {
    api = useVoicePipeline();
    return null;
  }
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      appStateHandler = handler as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
  await act(async () => {
    TestRenderer.create(React.createElement(Probe));
  });
  return api;
}

const mockTranscribe = transcribeGooglePcm as jest.Mock;
const mockTurn = runAssistantTurn as jest.Mock;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  appStateHandler = null;
  mockRecorder.start.mockResolvedValue(undefined);
  mockRecorder.stop.mockResolvedValue({ audioBase64: 'AAAA', sampleRate: 16000 });
  mockTranscribe.mockResolvedValue('რა ამინდია');
  mockTurn.mockResolvedValue(undefined);
  (streamingEnabled as jest.Mock).mockResolvedValue(false);
  (ensureMicrophonePermission as jest.Mock).mockResolvedValue(true);
  useVoiceStore.setState({
    isListening: false,
    isThinking: false,
    isSpeaking: false,
    currentTranscript: '',
    error: null,
  });
});

describe('hands-free conversation loop', () => {
  test('re-arms the mic after a completed answer', async () => {
    const p = await mountPipeline();

    await act(async () => {
      await p.startListening();
    });
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      await p.stopListeningAndSend();
    });

    // The answer finished, so the next turn starts without a second tap.
    expect(mockTurn).toHaveBeenCalledTimes(1);
    expect(mockRecorder.start).toHaveBeenCalledTimes(2);
    expect(p.isConversationActive()).toBe(true);
    expect(useVoiceStore.getState().isListening).toBe(true);
  });

  test('a tap mid-answer ends the session and blocks the re-arm', async () => {
    const p = await mountPipeline();

    // Hold the turn open so we can "tap stop" while Mia is still answering.
    let finishTurn!: () => void;
    mockTurn.mockReturnValue(
      new Promise<void>((resolve) => {
        finishTurn = resolve;
      }),
    );

    await act(async () => {
      await p.startListening();
    });

    let sending!: Promise<void>;
    await act(async () => {
      sending = p.stopListeningAndSend();
      await Promise.resolve();
    });

    await act(async () => {
      await p.stopConversation();
      finishTurn();
      await sending;
    });

    expect(p.isConversationActive()).toBe(false);
    // Still just the opening tap — the settled turn must not reopen the mic.
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().isListening).toBe(false);
  });

  test('a failed transcription ends the session instead of looping', async () => {
    const p = await mountPipeline();
    mockTranscribe.mockRejectedValue(new Error('Transcription failed'));

    await act(async () => {
      await p.startListening();
    });
    await act(async () => {
      await p.stopListeningAndSend();
    });

    expect(mockTurn).not.toHaveBeenCalled();
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    expect(p.isConversationActive()).toBe(false);
    expect(useVoiceStore.getState().error).toBe('Transcription failed');
  });

  test('an empty transcription ends the session', async () => {
    const p = await mountPipeline();
    mockTranscribe.mockResolvedValue('   ');

    await act(async () => {
      await p.startListening();
    });
    await act(async () => {
      await p.stopListeningAndSend();
    });

    expect(mockTurn).not.toHaveBeenCalled();
    expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    expect(p.isConversationActive()).toBe(false);
  });

  test('backgrounding the app releases the mic and drops the recording', async () => {
    const p = await mountPipeline();

    await act(async () => {
      await p.startListening();
    });
    expect(useVoiceStore.getState().isListening).toBe(true);

    // RN pauses JS timers while backgrounded, so the silence VAD can't close
    // this turn — without the AppState hook the mic would stay open.
    await act(async () => {
      appStateHandler?.('background');
    });

    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).not.toHaveBeenCalled(); // audio dropped, not sent
    expect(p.isConversationActive()).toBe(false);
    expect(useVoiceStore.getState().isListening).toBe(false);
  });

  test('the mic-permission dialog pausing the app does not kill the session', async () => {
    const p = await mountPipeline();

    // Android reports a pause while the permission dialog is up. That happens
    // inside startListening, before recording begins — nothing is in flight.
    await act(async () => {
      appStateHandler?.('background');
    });
    expect(mockRecorder.stop).not.toHaveBeenCalled();

    await act(async () => {
      await p.startListening();
    });
    expect(p.isConversationActive()).toBe(true);
    expect(useVoiceStore.getState().isListening).toBe(true);
  });

  test('stopConversation discards the recording rather than sending it', async () => {
    const p = await mountPipeline();

    await act(async () => {
      await p.startListening();
    });
    await act(async () => {
      await p.stopConversation();
    });

    expect(mockRecorder.stop).toHaveBeenCalledTimes(1); // mic released…
    expect(mockTranscribe).not.toHaveBeenCalled(); // …but nothing transcribed
    expect(mockTurn).not.toHaveBeenCalled();
    expect(p.isConversationActive()).toBe(false);
  });
});
