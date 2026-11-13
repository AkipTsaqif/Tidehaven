import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, ageInYears, formatSimDate, isAdult, isShippingDay, lifeStage, toSimDate } from '../../src/domain/clock.js';

describe('calendar', () => {
  it('measures adulthood as exactly 6570 daily turns', () => {
    expect(DEFAULT_CALENDAR.adultDays).toBe(18 * 365);
    expect(DEFAULT_CALENDAR.adultDays).toBe(6_570);
    expect(isAdult(0, 6_569)).toBe(false);
    expect(isAdult(0, 6_570)).toBe(true);
    expect(lifeStage(0, 6_570)).toBe('adult');
    expect(lifeStage(0, 23_725)).toBe('elder');
  });

  it('uses a toy 365-day year with real month and weekday names', () => {
    const date = toSimDate(0);
    expect(date.year).toBe(1);
    expect(date.month).toBe(1);
    expect(date.dayOfMonth).toBe(1);
    expect(formatSimDate(365)).toBe('Year 2, January 1');
    expect(isShippingDay(7)).toBe(true);
    expect(isShippingDay(8)).toBe(false);
  });

  it('computes ages in whole years from birth days', () => {
    expect(ageInYears(0, 364)).toBe(0);
    expect(ageInYears(0, 365)).toBe(1);
  });

  it('reaches adulthood on exactly the 6570th day after birth', () => {
    const born = 1_000;
    expect(isAdult(born, born + 6_569)).toBe(false);
    expect(isAdult(born, born + 6_570)).toBe(true);
  });
});
