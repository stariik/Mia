export function enabledFor(userId: string): boolean {
  if (process.env.STT_ENABLED !== 'true') return false;
  return (
    process.env.STT_ROLLOUT === 'all' ||
    (process.env.STT_TEST_USERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(userId)
  );
}
export function providerName(): 'google' | 'elevenlabs' {
  if (process.env.STT_PROVIDER === 'google') return 'google';
  if (!process.env.STT_PROVIDER || process.env.STT_PROVIDER === 'elevenlabs')
    return 'elevenlabs';
  throw new Error('Invalid STT_PROVIDER');
}
