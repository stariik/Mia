import { userErrorMessage } from '@/lib/errorMessages';

describe('userErrorMessage', () => {
  test('maps STT failures to "did not understand"', () => {
    expect(userErrorMessage('Empty transcription.')).toContain('ვერ გავიგე');
    expect(userErrorMessage('Transcription timed out')).toContain('ვერ გავიგე');
    expect(userErrorMessage('Chirp 2 (500): boom')).toContain('ვერ გავიგე');
  });

  test('maps chat stream failures', () => {
    expect(userErrorMessage('Stream stalled')).toContain('პასუხი ვერ მოვიდა');
    expect(userErrorMessage('Chat stream failed')).toContain('პასუხი ვერ მოვიდა');
  });

  test('maps offline and guard responses', () => {
    expect(userErrorMessage('Network request failed')).toContain('ინტერნეტ');
    expect(userErrorMessage('rate limit exceeded')).toContain('ბევრი მოთხოვნა');
    expect(userErrorMessage('unauthorized')).toContain('ავტორიზაცია');
  });

  test('passes through already-Georgian messages unchanged', () => {
    const ka = 'სერვერის მისამართი არ არის კონფიგურირებული';
    expect(userErrorMessage(ka)).toBe(ka);
  });

  test('falls back to generic for unknown errors', () => {
    expect(userErrorMessage('ECONNREFUSED 127.0.0.1')).toContain(
      'სერვერთან კავშირი ვერ მოხერხდა',
    );
    expect(userErrorMessage(null)).toBe('სერვერთან კავშირი ვერ მოხერხდა');
  });
});
