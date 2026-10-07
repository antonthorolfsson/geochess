const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumSignificantDigits: 3,
});
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const threeDigits = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });

export const formatCount = (n: number | null) => (n === null ? '—' : compactNumber.format(n));
export const formatUsd = (n: number | null) => (n === null ? '—' : compactUsd.format(n));
export const formatArea = (km2: number | null) => (km2 === null ? '—' : `${wholeNumber.format(km2)} km²`);
/** Area in a few characters, for large totals: "25.3M km²". */
export const formatAreaCompact = (km2: number | null) => (km2 === null ? '—' : `${compactNumber.format(km2)} km²`);
export const formatInt = (n: number) => wholeNumber.format(n);
/** A count in full, for things counted in the hundreds or thousands: "4,666". */
export const formatWhole = (n: number | null) => (n === null ? '—' : wholeNumber.format(n));
/** Energy in terawatt-hours: whole from 100 up ("9,977 TWh"), three digits below ("34.4 TWh"). */
export const formatTwh = (n: number | null) =>
  n === null ? '—' : `${n >= 100 ? wholeNumber.format(n) : threeDigits.format(n)} TWh`;

const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
/** A day in the weeks ahead, in the viewer's time zone: "Tuesday 14 October", or "14 Oct" `short`. */
export const formatDay = (iso: string, { short = false } = {}) => (short ? shortDay : longDay).format(new Date(iso));

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
