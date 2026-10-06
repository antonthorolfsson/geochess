import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatAreaCompact,
  formatCount,
  formatTwh,
  formatUsd,
  formatWhole,
  ordinal,
  relativeTime,
} from './format';
import { safeNext } from './paths';

describe('number formatting', () => {
  it('abbreviates large figures', () => {
    expect(formatCount(1_412_000_000)).toBe('1.41B');
    expect(formatCount(38_400_000)).toBe('38.4M');
    expect(formatUsd(1_230_000_000_000)).toBe('$1.23T');
    expect(formatArea(312_696)).toBe('312,696 km²');
    expect(formatAreaCompact(25_341_708)).toBe('25.3M km²');
  });

  it('writes counts in full and energy in terawatt-hours', () => {
    expect(formatWhole(4666)).toBe('4,666');
    expect(formatTwh(9977.384)).toBe('9,977 TWh');
    expect(formatTwh(34.412)).toBe('34.4 TWh');
    expect(formatTwh(0.145)).toBe('0.145 TWh');
    expect(formatTwh(0)).toBe('0 TWh');
  });

  it('shows a dash for missing data', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatUsd(null)).toBe('—');
    expect(formatWhole(null)).toBe('—');
    expect(formatTwh(null)).toBe('—');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
  });

  it('describes recent times', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(relativeTime('2026-09-26T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-09-26T11:30:00Z', now)).toBe('30m ago');
    expect(relativeTime('2026-09-26T07:00:00Z', now)).toBe('5h ago');
    expect(relativeTime('2026-09-23T12:00:00Z', now)).toBe('3d ago');
  });
});

describe('safeNext', () => {
  it('only allows same-site paths, and otherwise leads to your campaigns', () => {
    expect(safeNext('/c/abc')).toBe('/c/abc');
    expect(safeNext('/')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/campaigns');
    expect(safeNext('//evil.example')).toBe('/campaigns');
    expect(safeNext('/\\evil.example')).toBe('/campaigns');
    expect(safeNext(undefined)).toBe('/campaigns');
  });
});
