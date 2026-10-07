import { describe, expect, it } from 'vitest';
import { CAMPAIGN_WIDTH, DETAILS_WIDTH, GAME_MAX, GAME_MIN, MAP_MIN, RAIL_WIDTH, roomLayout } from './room-layout';

/** The room on common screens: the window less the campaign header's 52 pixels. */
const room = (width: number, height: number) => [width, height - 52] as const;

describe('room layout', () => {
  it('keeps three columns only while the map keeps its room', () => {
    expect(roomLayout(...room(1024, 768), false)).toEqual({ campaignColumn: false, detailsWidth: DETAILS_WIDTH });
    expect(roomLayout(...room(1280, 800), false)).toEqual({ campaignColumn: false, detailsWidth: DETAILS_WIDTH });
    expect(roomLayout(...room(1366, 768), false)).toEqual({ campaignColumn: true, detailsWidth: DETAILS_WIDTH });
    expect(roomLayout(...room(1440, 900), false)).toEqual({ campaignColumn: true, detailsWidth: DETAILS_WIDTH });
    // Exactly at the edge: the map keeps MAP_MIN.
    expect(roomLayout(CAMPAIGN_WIDTH + MAP_MIN + DETAILS_WIDTH, 700, false).campaignColumn).toBe(true);
    expect(roomLayout(CAMPAIGN_WIDTH + MAP_MIN + DETAILS_WIDTH - 1, 700, false).campaignColumn).toBe(false);
  });

  it('gives a game the width the board needs to fill the height, folding the left column first', () => {
    // 1440 × 900: the board gets 638 pixels (was 428), so the war room folds into the rail.
    expect(roomLayout(...room(1440, 900), true)).toEqual({ campaignColumn: false, detailsWidth: 670 });
    // Wide and tall: the board stops growing, and all three columns fit.
    expect(roomLayout(...room(1920, 1080), true)).toEqual({ campaignColumn: true, detailsWidth: GAME_MAX });
    // A tablet in landscape: more board than before (was 428) and more map (was 224).
    const tablet = roomLayout(...room(1024, 768), true);
    expect(tablet.detailsWidth).toBe(538);
    expect(1024 - RAIL_WIDTH - tablet.detailsWidth).toBe(422);
  });

  it('keeps some map beside a game on tall, narrow screens, and a usable board on short ones', () => {
    // A tablet in portrait: the board would like 680 pixels, but the map keeps 360.
    expect(roomLayout(...room(1024, 1366), true).detailsWidth).toBe(1024 - RAIL_WIDTH - 360);
    // A short window: the board doesn't shrink below what's playable; the column scrolls instead.
    expect(roomLayout(...room(1280, 560), true).detailsWidth).toBe(GAME_MIN);
  });
});
