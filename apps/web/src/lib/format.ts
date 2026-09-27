const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumSignificantDigits: 3,
});
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatCount = (n: number | null) => (n === null ? '—' : compactNumber.format(n));
export const formatUsd = (n: number | null) => (n === null ? '—' : compactUsd.format(n));
export const formatArea = (km2: number | null) => (km2 === null ? '—' : `${wholeNumber.format(km2)} km²`);
export const formatInt = (n: number) => wholeNumber.format(n);

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
