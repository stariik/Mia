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

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { useVoicePipeline } from '@/hooks/useVoicePipeline';
import { runAssistantTurn } from '@/lib/assistantTurn';
import { useVoiceStore } from '@/stores/voiceStore';

type Pipeline = ReturnType<typeof useVoicePipeline>;

// The probe never subscribes to the store (the hook reads it via getState), so
// it renders once and the returned callbacks stay valid for the whole test.
async function mountPipeline(): Promise<Pipeline> {
  let api!: Pipeline;
  function Probe() {
    api = useVoicePipeline();
    return null;
  }
  await act(async () => {
    TestRenderer.create(React.createElement(Probe));
  });
  return api;
}

const mockTranscribe = transcribeGooglePcm as jest.Mock;
const mockTurn = runAssistantTurn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.start.mockResolvedValue(undefined);
  mockRecorder.stop.mockResolvedValue({ audioBase64: 'AAAA', sampleRate: 16000 });
  mockTranscribe.mockResolvedValue('რა ამინდია');
  mockTurn.mockResolvedValue(undefined);
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
