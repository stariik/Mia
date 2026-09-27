import { afterWakeWord, matchMusicCommand } from '@/lib/musicCommands';

describe('matchMusicCommand', () => {
  test('pause, with or without the wake word', () => {
    expect(matchMusicCommand('მია პაუზა')).toBe('pause');
    expect(matchMusicCommand('მია, გააჩერე მუსიკა.')).toBe('pause');
    expect(matchMusicCommand('Mia pause the music')).toBe('pause');
    expect(matchMusicCommand('Hey Mia, pause')).toBe('pause');
    expect(matchMusicCommand('გააჩერე')).toBe('pause');
    expect(matchMusicCommand('დააპაუზე გთხოვ')).toBe('pause');
    expect(matchMusicCommand('მია პოუზ')).toBe('pause');
    expect(matchMusicCommand('გამიჩერე')).toBe('pause');
    expect(matchMusicCommand('დამიპაუზე')).toBe('pause');
    expect(matchMusicCommand('შეწყვიტე მუსიკა')).toBe('pause');
    expect(matchMusicCommand('მუსიკა გააჩერე')).toBe('pause');
  });

  test('continue, with or without the wake word', () => {
    expect(matchMusicCommand('continue')).toBe('resume');
    expect(matchMusicCommand('Continue the music')).toBe('resume');
    expect(matchMusicCommand('მია გააგრძელე')).toBe('resume');
    expect(matchMusicCommand('გააგრძელე მუსიკა')).toBe('resume');
    expect(matchMusicCommand('კონტინიუ')).toBe('resume');
    expect(matchMusicCommand('ისევ ჩართე')).toBe('resume');
    expect(matchMusicCommand('ჩართე მუსიკა')).toBe('resume');
    expect(matchMusicCommand('გამიგრძელე')).toBe('resume');
    expect(matchMusicCommand('ისევ ჩამირთე')).toBe('resume');
    expect(matchMusicCommand('განაგრძე')).toBe('resume');
  });

  test('drops words heard before the wake word', () => {
    expect(matchMusicCommand('la la love მია პაუზა')).toBe('pause');
  });

  test('leaves anything else to the assistant', () => {
    expect(matchMusicCommand('გააგრძელე ზღაპარი')).toBeNull();
    // Timer/alarm commands must reach the assistant, not pause the music.
    expect(matchMusicCommand('გააჩერე ტაიმერი')).toBeNull();
    expect(matchMusicCommand('მია, გააჩერე მაღვიძარა')).toBeNull();
    expect(matchMusicCommand('გამორთე მაღვიძარა')).toBeNull();
    expect(matchMusicCommand('Mia, pause the timer')).toBeNull();
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

describe('afterWakeWord', () => {
  test('keeps only what follows the wake word', () => {
    expect(afterWakeWord('მია, პაუზა')).toBe('პაუზა');
    expect(afterWakeWord('la la love Mia what time is it?')).toBe('what time is it?');
    expect(afterWakeWord('ჰეი მია რა ამინდია')).toBe('რა ამინდია');
  });

  test('is empty when only the wake word was heard', () => {
    expect(afterWakeWord('მია')).toBe('');
    expect(afterWakeWord('Mia.')).toBe('');
  });

  test('leaves text without a wake word alone, including words that contain it', () => {
    expect(afterWakeWord('რა ამინდია?')).toBe('რა ამინდია?');
    expect(afterWakeWord('მიამიში რა ამინდია')).toBe('მიამიში რა ამინდია');
  });
});
