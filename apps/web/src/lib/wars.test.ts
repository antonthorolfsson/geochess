import { describe, expect, it } from 'vitest';
import { formatClock, resultText, timeControlText, timeLeft } from './wars';

describe('war text', () => {
  it('describes game results', () => {
    expect(resultText('1-0', 'checkmate')).toBe('White wins by checkmate');
    expect(resultText('0-1', 'timeout')).toBe('Black wins on time');
    expect(resultText('1/2-1/2', 'agreement')).toBe('Draw by agreement');
  });

  it('counts down to deadlines', () => {
    expect(timeLeft(0)).toBe('no time');
    expect(timeLeft(12_300)).toBe('13s');
    expect(timeLeft(250_000)).toBe('4m 10s');
    expect(timeLeft(23 * 3_600_000 + 12 * 60_000)).toBe('23h 12m');
    expect(timeLeft(24 * 3_600_000)).toBe('24h 0m');
    expect(timeLeft(50 * 3_600_000)).toBe('2d 2h');
  });

  it('formats chess clocks, with tenths when time is short', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(61_500)).toBe('1:01');
    expect(formatClock(9_460)).toBe('9.4');
    expect(formatClock(-5)).toBe('0.0');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('describes time controls with modifiers applied', () => {
    const live = {
      kind: 'live' as const,
      white: { initialMs: 300_000, incrementMs: 3000 },
      black: { initialMs: 345_000, incrementMs: 3450 },
    };
    expect(timeControlText(live, 'white')).toBe('5+3');
    expect(timeControlText(live, 'black')).toBe('5.75+3.45');
    const corr = {
      kind: 'correspondence' as const,
      white: { perMoveMs: 86_400_000 },
      black: { perMoveMs: 90_720_000 },
    };
    expect(timeControlText(corr, 'white')).toBe('1 day per move');
    expect(timeControlText(corr, 'black')).toBe('25.2 hours per move');
  });
});
