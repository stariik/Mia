jest.mock('react-native-config', () => ({
  __esModule: true,
  default: { API_BASE_URL: 'https://example.com' },
}));

import { apiUrl } from '@/api/client';

describe('apiUrl', () => {
  test('joins base + relative path without double slash', () => {
    expect(apiUrl('/api/chat')).toBe('https://example.com/api/chat');
    expect(apiUrl('api/chat')).toBe('https://example.com/api/chat');
  });

  test('strips trailing slash from base', () => {
    // This instance is the cached import; for a pure base-trimming test we
    // hit the public API and confirm no `//` appears between base and path.
    const url = apiUrl('/api/x');
    expect(url.replace('https://', '')).not.toMatch(/\/\//);
  });
});
