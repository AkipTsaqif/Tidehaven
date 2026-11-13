/**
 * The toy calendar. One simulated day per turn, 365 days per year, no leap years.
 * Age is measured in days; adulthood is 18 years = 6570 days.
 */

export interface CalendarConfig {
  daysPerYear: number;
  adultDays: number;
  elderDays: number;
  pregnancyDays: number;
  weekDays: number;
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  daysPerYear: 365,
  adultDays: 6570,
  elderDays: 23725,
  pregnancyDays: 280,
  weekDays: 7,
};

export interface SimDate {
  day: number;
  year: number;
  dayOfYear: number;
  month: number;
  dayOfMonth: number;
  weekday: number;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function toSimDate(day: number, calendar: CalendarConfig = DEFAULT_CALENDAR): SimDate {
  const safeDay = Math.max(0, Math.trunc(day));
  const year = Math.floor(safeDay / calendar.daysPerYear) + 1;
  const dayOfYear = safeDay % calendar.daysPerYear;
  let remaining = dayOfYear;
  let month = 0;
  while (month < MONTH_LENGTHS.length && remaining >= (MONTH_LENGTHS[month] ?? 0)) {
    remaining -= MONTH_LENGTHS[month] ?? 0;
    month += 1;
  }
  return {
    day: safeDay,
    year,
    dayOfYear,
    month: month + 1,
    dayOfMonth: remaining + 1,
    weekday: safeDay % calendar.weekDays,
  };
}

export function formatSimDate(day: number, calendar: CalendarConfig = DEFAULT_CALENDAR): string {
  const date = toSimDate(day, calendar);
  const monthName = MONTH_NAMES[date.month - 1] ?? 'Month';
  return `Year ${date.year}, ${monthName} ${date.dayOfMonth}`;
}

export function weekdayName(day: number, calendar: CalendarConfig = DEFAULT_CALENDAR): string {
  return WEEKDAY_NAMES[toSimDate(day, calendar).weekday] ?? 'Monday';
}

export function ageInDays(bornDay: number, today: number): number {
  return Math.max(0, today - bornDay);
}

export function ageInYears(bornDay: number, today: number, calendar: CalendarConfig = DEFAULT_CALENDAR): number {
  return Math.floor(ageInDays(bornDay, today) / calendar.daysPerYear);
}

export type LifeStage = 'child' | 'adult' | 'elder';

export function lifeStage(bornDay: number, today: number, calendar: CalendarConfig = DEFAULT_CALENDAR): LifeStage {
  const age = ageInDays(bornDay, today);
  if (age < calendar.adultDays) return 'child';
  if (age < calendar.elderDays) return 'adult';
  return 'elder';
}

export function isAdult(bornDay: number, today: number, calendar: CalendarConfig = DEFAULT_CALENDAR): boolean {
  return lifeStage(bornDay, today, calendar) !== 'child';
}

/** Labour points available for one day of work by life stage. */
export function labourCapacity(stage: LifeStage): number {
  if (stage === 'adult') return 100;
  if (stage === 'elder') return 50;
  return 0;
}

export function isShippingDay(day: number, calendar: CalendarConfig = DEFAULT_CALENDAR): boolean {
  return day > 0 && day % calendar.weekDays === 0;
}

export function isElectionDay(day: number, calendar: CalendarConfig = DEFAULT_CALENDAR): boolean {
  return day > 0 && day % calendar.daysPerYear === 0;
}

export function monthKey(day: number, calendar: CalendarConfig = DEFAULT_CALENDAR): string {
  const date = toSimDate(day, calendar);
  return `${date.year}-${String(date.month).padStart(2, '0')}`;
}
