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
 *   · 31..90 days after              → Recent (a set is still the current one people are opening
 *                                      well past its first month; a quarter is about how long)
 *   · older, or no date              → nothing, and nothing is the common case
 *
 * DATES ARE CALENDAR DAYS, NOT INSTANTS. A release date is 'yyyy-mm-dd' with no timezone, so both
 * sides are pinned to UTC midnight before subtracting: parsing '2026-09-04' as a local Date puts a
 * user west of UTC a day behind and would show "1 Day To-Go" on release morning.
 */
export type ReleaseTagKind = 'upcoming' | 'countdown' | 'just-released' | 'very-recent' | 'recent';
export interface ReleaseTag {
    kind: ReleaseTagKind;
    /** Ready to render, e.g. 'Upcoming', '12 Days To-Go', 'Just Released!', 'Very Recent', 'Recent'. */
    label: string;
    /** Whole days until release. Positive = future, 0 = today, negative = days since release. */
    days: number;
}
/**
 * ONE SIZE FOR EVERY RELEASE TAG, everywhere it appears.
 *
 * These badges grew up on separate surfaces and ended up at five different sizes: 7pt on michi's
 * sealed rail, 8pt on the kit's sealed tiles, 9pt on the Recent & Upcoming tiles, browse set tiles
 * and the strip kickers, and 12pt on the sealed product page. The same sentence read as a footnote
 * in one place and a heading in another. Owner decision: take the largest of them and add a
 * quarter, so 12 becomes 15, and give every surface that number from here.
 *
 * Exported rather than duplicated because the apps draw their own sealed tiles (michi does not
 * mount the kit's SealedBrowser), and a second copy of this number is how they drifted apart.
 */
export declare const RELEASE_TAG_FONT_SIZE = 15;
/** Line box for RELEASE_TAG_FONT_SIZE — tight, since a badge is always one line. */
export declare const RELEASE_TAG_LINE_HEIGHT = 18;
/** The countdown window, and the width of each band after release. */
export declare const RELEASE_SOON_DAYS = 30;
export declare const JUST_RELEASED_DAYS = 7;
export declare const VERY_RECENT_DAYS = 30;
export declare const RECENT_DAYS = 90;
/** Today as 'yyyy-mm-dd' in the viewer's own timezone — which day it is where they are. */
export declare function todayISO(now?: Date): string;
/** Whole calendar days from `today` to `releaseDate`; null if either is unparseable. */
export declare function daysUntilRelease(releaseDate: string, today?: string): number | null;
/**
 * The badge for a release date, or null when the date is missing, unparseable, or simply old
 * enough that saying anything would be noise.
 */
export declare function releaseTag(releaseDate: string, today?: string): ReleaseTag | null;
/** True while the date is in the future — the old binary the feeds used, kept for tile ordering. */
export declare function isUpcoming(releaseDate: string, today?: string): boolean;
