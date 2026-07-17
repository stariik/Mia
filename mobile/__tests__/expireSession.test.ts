const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockState = { token: 'tok' as string | null, logout: mockLogout };

jest.mock('@/stores/authStore', () => ({
  useAuthStore: {
    getState: () => mockState,
  },
}));

import { expireSessionIf401 } from '@/api/client';

describe('expireSessionIf401', () => {
  beforeEach(() => {
    mockLogout.mockClear();
    mockState.token = 'tok';
  });

  test('logs out on 401 / unauthorized messages', () => {
    expireSessionIf401('Chirp 2 (401): unauthorized');
    expireSessionIf401('unauthorized');
    expect(mockLogout).toHaveBeenCalledTimes(2);
  });

  test('ignores other errors', () => {
    expireSessionIf401('Network request failed');
    expireSessionIf401('rate limit exceeded (429)');
    expireSessionIf401(null);
    expect(mockLogout).not.toHaveBeenCalled();
  });

  test('no-op when already signed out', () => {
    mockState.token = null;
    expireSessionIf401('unauthorized');
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
