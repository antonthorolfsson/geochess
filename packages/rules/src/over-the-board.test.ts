import { describe, expect, it } from 'vitest';
import { overTheBoard, type OverTheBoardState } from './over-the-board';

const ANN = 'ann';
const BO = 'bo';

const game = (state: Partial<OverTheBoardState> = {}): OverTheBoardState => ({
  status: 'playing',
  whiteId: ANN,
  blackId: BO,
  offerBy: null,
  overTheBoard: false,
  report: null,
  ...state,
});

describe('moving a game over the board', () => {
  it('takes an offer and the other player’s acceptance', () => {
    expect(overTheBoard(game(), ANN, 'offer')).toEqual({ ok: true, change: { offerBy: ANN } });
    expect(overTheBoard(game({ offerBy: ANN }), BO, 'accept')).toEqual({
      ok: true,
      change: { offerBy: null, overTheBoard: true },
    });
    // Offering back accepts.
    expect(overTheBoard(game({ offerBy: ANN }), BO, 'offer')).toEqual({
      ok: true,
      change: { offerBy: null, overTheBoard: true },
    });
  });

  it('can be declined, but not accepted by the player who offered', () => {
    expect(overTheBoard(game({ offerBy: ANN }), BO, 'decline')).toEqual({ ok: true, change: { offerBy: null } });
    expect(overTheBoard(game({ offerBy: ANN }), ANN, 'accept')).toEqual({ ok: false, reason: 'no-offer' });
    expect(overTheBoard(game({ offerBy: ANN }), ANN, 'offer')).toEqual({ ok: false, reason: 'offered' });
    expect(overTheBoard(game(), BO, 'decline')).toEqual({ ok: false, reason: 'no-offer' });
  });

  it('needs two people and a game underway', () => {
    expect(overTheBoard(game(), ANN, 'offer', new Set([BO]))).toEqual({ ok: false, reason: 'bot' });
    expect(overTheBoard(game({ offerBy: ANN }), BO, 'accept', new Set([BO]))).toEqual({ ok: false, reason: 'bot' });
    for (const status of ['waiting', 'finished', 'cancelled'] as const) {
      expect(overTheBoard(game({ status }), ANN, 'offer')).toEqual({ ok: false, reason: 'not-playing' });
    }
    expect(overTheBoard(game({ overTheBoard: true }), ANN, 'offer')).toEqual({ ok: false, reason: 'over-the-board' });
  });
});

describe('reporting the result', () => {
  const otb = (report: OverTheBoardState['report'] = null) => game({ overTheBoard: true, report });

  it('reports a win for the reporter, or a draw, which the other player confirms', () => {
    expect(overTheBoard(otb(), BO, 'report-win')).toEqual({ ok: true, change: { report: { by: BO, result: '0-1' } } });
    expect(overTheBoard(otb(), ANN, 'report-win')).toEqual({
      ok: true,
      change: { report: { by: ANN, result: '1-0' } },
    });
    expect(overTheBoard(otb(), ANN, 'report-draw')).toEqual({
      ok: true,
      change: { report: { by: ANN, result: '1/2-1/2' } },
    });
    expect(overTheBoard(otb({ by: BO, result: '0-1' }), ANN, 'confirm')).toEqual({
      ok: true,
      change: { report: null, ending: '0-1' },
    });
  });

  it('can be disputed, which leaves the game over the board', () => {
    expect(overTheBoard(otb({ by: BO, result: '0-1' }), ANN, 'dispute')).toEqual({
      ok: true,
      change: { report: null },
    });
  });

  it('is answered only by the other player, who can’t report over it', () => {
    const report = { by: BO, result: '0-1' } as const;
    expect(overTheBoard(otb(report), BO, 'confirm')).toEqual({ ok: false, reason: 'no-report' });
    expect(overTheBoard(otb(report), BO, 'dispute')).toEqual({ ok: false, reason: 'no-report' });
    expect(overTheBoard(otb(report), ANN, 'report-win')).toEqual({ ok: false, reason: 'report-waiting' });
    // The reporter may change their mind.
    expect(overTheBoard(otb(report), BO, 'report-draw')).toEqual({
      ok: true,
      change: { report: { by: BO, result: '1/2-1/2' } },
    });
    expect(overTheBoard(otb(), ANN, 'confirm')).toEqual({ ok: false, reason: 'no-report' });
  });

  it('needs the game over the board', () => {
    expect(overTheBoard(game(), ANN, 'report-win')).toEqual({ ok: false, reason: 'online' });
    expect(overTheBoard(game(), ANN, 'online')).toEqual({ ok: false, reason: 'online' });
  });

  it('goes back online at either player’s word, once no report is waiting', () => {
    expect(overTheBoard(otb(), BO, 'online')).toEqual({ ok: true, change: { overTheBoard: false } });
    expect(overTheBoard(otb({ by: ANN, result: '1-0' }), BO, 'online')).toEqual({
      ok: false,
      reason: 'report-waiting',
    });
  });
});
