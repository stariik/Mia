/* eslint-env jest */
// Expo native modules don't exist under Jest. Tests run as a native build
// (not Expo Go), so these stubs only need to answer the few calls made at
// import time.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'bare', expoConfig: null },
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient',
  },
}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: {} }));
jest.mock('expo-audio', () => ({ AudioModule: {}, setAudioModeAsync: jest.fn().mockResolvedValue(undefined) }));
