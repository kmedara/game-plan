import { birthdayPartOrder, composeBirthday, splitBirthday } from './birthday';

describe('birthday fields', () => {
  const today = new Date(2026, 9, 15);

  it('orders the boxes from the locale', () => {
    expect(birthdayPartOrder('en-US')).toEqual(['month', 'day', 'year']);
    expect(birthdayPartOrder('es')).toEqual(['day', 'month', 'year']);
  });

  it('builds an ISO date only when the three boxes are a real date', () => {
    expect(composeBirthday('3', '14', '2008', today)).toBe('2008-03-14');
    expect(composeBirthday('2', '31', '2008', today)).toBeUndefined();
    expect(composeBirthday('3', '14', '200', today)).toBeUndefined();
    expect(composeBirthday('10', '16', '2026', today)).toBeUndefined();
  });

  it('splits a stored birthday back into the boxes', () => {
    expect(splitBirthday('2008-03-04')).toEqual({ month: '3', day: '4', year: '2008' });
    expect(splitBirthday('')).toEqual({ month: '', day: '', year: '' });
  });
});
