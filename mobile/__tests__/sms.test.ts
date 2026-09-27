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
});
