import { apiUrl } from '@/api/client';

// Jest runs with __DEV__ = true, so env.apiBaseUrl is the dev localhost URL.
const BASE = 'http://localhost:3002';

describe('apiUrl', () => {
  test('joins base + relative path without double slash', () => {
    expect(apiUrl('/api/chat')).toBe(`${BASE}/api/chat`);
    expect(apiUrl('api/chat')).toBe(`${BASE}/api/chat`);
  });

  test('never produces // between base and path', () => {
    const url = apiUrl('/api/x');
    expect(url.replace('http://', '')).not.toMatch(/\/\//);
  });
});
