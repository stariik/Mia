import { matchMusicCommand } from '@/lib/musicCommands';

describe('matchMusicCommand', () => {
  test('pause, with or without the wake word', () => {
    expect(matchMusicCommand('მია პაუზა')).toBe('pause');
    expect(matchMusicCommand('მია, გააჩერე მუსიკა.')).toBe('pause');
    expect(matchMusicCommand('Mia pause the music')).toBe('pause');
    expect(matchMusicCommand('Hey Mia, pause')).toBe('pause');
    expect(matchMusicCommand('გააჩერე')).toBe('pause');
    expect(matchMusicCommand('დააპაუზე გთხოვ')).toBe('pause');
    expect(matchMusicCommand('მია პოუზ')).toBe('pause');
  });

  test('continue, with or without the wake word', () => {
    expect(matchMusicCommand('continue')).toBe('resume');
    expect(matchMusicCommand('Continue the music')).toBe('resume');
    expect(matchMusicCommand('მია გააგრძელე')).toBe('resume');
    expect(matchMusicCommand('გააგრძელე მუსიკა')).toBe('resume');
    expect(matchMusicCommand('კონტინიუ')).toBe('resume');
    expect(matchMusicCommand('ისევ ჩართე')).toBe('resume');
    expect(matchMusicCommand('ჩართე მუსიკა')).toBe('resume');
  });

  test('drops words heard before the wake word', () => {
    expect(matchMusicCommand('la la love მია პაუზა')).toBe('pause');
  });

  test('leaves anything else to the assistant', () => {
    expect(matchMusicCommand('გააგრძელე ზღაპარი')).toBeNull();
    expect(matchMusicCommand('არ გააჩერო')).toBeNull();
    expect(matchMusicCommand('რატომ გააჩერე?')).toBeNull();
    expect(matchMusicCommand('ჩართე')).toBeNull();
    expect(matchMusicCommand('ჩამირთე ბიტლზი')).toBeNull();
    expect(matchMusicCommand('გააჩერე და გააგრძელე')).toBeNull();
    expect(matchMusicCommand('მია')).toBeNull();
    expect(matchMusicCommand('რა ამინდია?')).toBeNull();
    expect(matchMusicCommand('')).toBeNull();
  });
});
