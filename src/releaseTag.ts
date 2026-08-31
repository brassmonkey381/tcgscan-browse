/**
 * HOW NEW IS THIS? — the one place that turns a release date into the badge every surface shows.
 *
 * Sets, sealed products and card strips all sat on the same timeline and each said something
 * different about it: the Recent & Upcoming feed knew only "upcoming or not", michi's sealed rail
 * said UPCOMING or NEW SET forever, and the sealed browser said nothing at all — so a box shipping
 * next week and one from two years ago read identically. One ladder here, imported everywhere, so
 * the same product cannot be "Upcoming" on one screen and undecorated on the next.
 *
 * THE LADDER, most urgent first:
 *   · more than 30 days out          → Upcoming
 *   · 1..30 days out                 → "12 Days To-Go" (the countdown is the point: it is the
 *                                      only tag that changes every morning, and pre-orders close)
 *   · release day .. 7 days after    → Just Released!
 *   · 8..30 days after               → Very Recent
 *   · older, or no date              → nothing, and nothing is the common case
 *
 * DATES ARE CALENDAR DAYS, NOT INSTANTS. A release date is 'yyyy-mm-dd' with no timezone, so both
 * sides are pinned to UTC midnight before subtracting: parsing '2026-09-04' as a local Date puts a
 * user west of UTC a day behind and would show "1 Day To-Go" on release morning.
 */

export type ReleaseTagKind = 'upcoming' | 'countdown' | 'just-released' | 'very-recent';

export interface ReleaseTag {
  kind: ReleaseTagKind;
  /** Ready to render, e.g. 'Upcoming', '12 Days To-Go', 'Just Released!', 'Very Recent'. */
  label: string;
  /** Whole days until release. Positive = future, 0 = today, negative = days since release. */
  days: number;
}

/** Days in the countdown window, and the width of both "recently released" bands. */
export const RELEASE_SOON_DAYS = 30;
export const JUST_RELEASED_DAYS = 7;
export const RECENT_DAYS = 30;

/** Today as 'yyyy-mm-dd' in the viewer's own timezone — which day it is where they are. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 'yyyy-mm-dd' → UTC midnight ms, or null when it is not a date. */
function utcDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** Whole calendar days from `today` to `releaseDate`; null if either is unparseable. */
export function daysUntilRelease(releaseDate: string, today: string = todayISO()): number | null {
  const a = utcDay(releaseDate);
  const b = utcDay(today);
  if (a == null || b == null) return null;
  return Math.round((a - b) / 86_400_000);
}

/**
 * The badge for a release date, or null when the date is missing, unparseable, or simply old
 * enough that saying anything would be noise.
 */
export function releaseTag(releaseDate: string, today: string = todayISO()): ReleaseTag | null {
  const days = daysUntilRelease(releaseDate, today);
  if (days == null) return null;
  if (days > RELEASE_SOON_DAYS) return { kind: 'upcoming', label: 'Upcoming', days };
  if (days > 0) {
    return { kind: 'countdown', label: `${days} ${days === 1 ? 'Day' : 'Days'} To-Go`, days };
  }
  // days <= 0: released. Release day itself reads as just released, not as a zero-day countdown.
  if (days >= -JUST_RELEASED_DAYS) return { kind: 'just-released', label: 'Just Released!', days };
  if (days >= -RECENT_DAYS) return { kind: 'very-recent', label: 'Very Recent', days };
  return null;
}

/** True while the date is in the future — the old binary the feeds used, kept for tile ordering. */
export function isUpcoming(releaseDate: string, today: string = todayISO()): boolean {
  const days = daysUntilRelease(releaseDate, today);
  return days != null && days > 0;
}
