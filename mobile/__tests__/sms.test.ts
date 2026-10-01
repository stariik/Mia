jest.mock('@/hooks/usePermissions', () => ({
  ensureContactsPermission: jest.fn().mockResolvedValue(true),
  ensureSendSmsPermission: jest.fn().mockResolvedValue(true),
}));

import { matchContacts, type Contact } from '@/lib/tools/sms';

const contacts: Contact[] = [
  { name: 'Deda', number: '+995 555 000 001' },
  { name: 'Nino Beridze', number: '555 000 002' },
  { name: 'ნინო კაპანაძე', number: '555 000 003' },
  { name: 'Ninoshvili Office', number: '555 000 004' },
  { name: 'Nino Beridze', number: '555 000 005' }, // second number, same contact
];

describe('matchContacts', () => {
  test('Georgian spoken name matches a Latin-saved contact exactly', () => {
    expect(matchContacts('დედა', contacts)).toEqual([contacts[0]]);
  });

  test('first name matches every contact with that word, one per name', () => {
    const names = matchContacts('ნინო', contacts).map((c) => c.name);
    expect(names).toEqual(['Nino Beridze', 'ნინო კაპანაძე']); // not "Ninoshvili"
  });

  test('full name narrows to one', () => {
    expect(matchContacts('ნინო ბერიძე', contacts)).toEqual([contacts[1]]);
  });

  test('substring is the last resort; unknown and empty find nothing', () => {
    expect(matchContacts('ninosh', contacts).map((c) => c.name)).toEqual([
      'Ninoshvili Office',
    ]);
    expect(matchContacts('გიორგი', contacts)).toEqual([]);
    expect(matchContacts('  ', contacts)).toEqual([]);
  });

  test('a Georgian name finds Latin (keyboard or spelled) and Russian spellings', () => {
    const book: Contact[] = [
      { name: 'Baco', number: '1' },
      { name: 'Batso', number: '2' },
      { name: 'Бацо', number: '3' },
      { name: 'ბაცო', number: '4' },
      { name: 'Bacho', number: '5' },
    ];
    expect(matchContacts('ბაცო', book).map((c) => c.name)).toEqual([
      'Baco',
      'Batso',
      'Бацо',
      'ბაცო',
    ]);
    expect(matchContacts('ბაჩო', book).map((c) => c.name)).toEqual(['Bacho']);
  });

  test('keyboard letters w / x and their spelled-out forms', () => {
    const book: Contact[] = [
      { name: 'Wiwi', number: '1' },
      { name: 'Xatia', number: '2' },
      { name: 'Khatia', number: '3' },
      { name: 'Хатия', number: '4' },
      { name: 'Yana', number: '5' },
    ];
    expect(matchContacts('წიწი', book).map((c) => c.name)).toEqual(['Wiwi']);
    expect(matchContacts('ხატია', book).map((c) => c.name)).toEqual([
      'Xatia',
      'Khatia',
      'Хатия',
    ]);
    expect(matchContacts('იანა', book).map((c) => c.name)).toEqual(['Yana']);
  });

  test('Russian full name narrows like a Latin one', () => {
    const book: Contact[] = [
      { name: 'Нино Беридзе', number: '1' },
      { name: 'Нино Капанадзе', number: '2' },
    ];
    expect(matchContacts('ნინო ბერიძე', book)).toEqual([book[0]]);
    expect(matchContacts('ნინო', book)).toEqual(book);
  });
});
