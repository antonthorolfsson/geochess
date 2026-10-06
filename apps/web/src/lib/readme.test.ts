import {
  CURRENT_MISSION_RULES,
  DEFAULT_LAST_ROUND,
  DEFAULT_RULES,
  PUBLIC_MISSION_KINDS,
  RESPONSE_WINDOW_TEXT,
  durationText,
  joinWords,
  kindName,
  missionRules,
} from '@empire/rules';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inWords, missionPointsMax, recordMissions } from './rules-text';

// The README can't read the rules, so this checks it quotes what new campaigns start with.
const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const cfg = missionRules(CURRENT_MISSION_RULES);
const { war } = DEFAULT_RULES;

describe('the README', () => {
  it('quotes the war settings new campaigns start with', () => {
    expect(readme).toContain(`worth at least ${war.stakeFloorPct}% of the target`);
    expect(readme).toContain(`a stake of ${war.raisePct}%`);
    expect(readme).toContain(`up to ${inWords(war.raises)} raises`);
    expect(readme).toContain(
      `go ahead after ${RESPONSE_WINDOW_TEXT.correspondence} (${RESPONSE_WINDOW_TEXT.live} live)`,
    );
  });

  it('quotes the current mission rules', () => {
    const { points, titles } = cfg;
    expect(readme).toContain(`mission rules version ${CURRENT_MISSION_RULES}`);
    expect(readme).toContain(`worth ${points.public} victory points each`);
    expect(readme).toContain(`worth ${points.secret}.`);
    expect(readme).toContain(`The default set is ${joinWords(cfg.defaultPublic.map((k) => kindName(k, cfg)))}`);
    expect(readme).toContain(`any ${inWords(cfg.publicCount)} of sixteen`);
    expect(PUBLIC_MISSION_KINDS).toHaveLength(16);
    expect(readme).toContain(`${kindName('one_billion', cfg)},`);
    expect(readme).toContain(`worth ${titles!.points} point each`);
    expect(readme).toContain(`The first to ${points.toWin} points wins at once`);
    expect(readme).toContain(`Missions alone can make ${missionPointsMax(cfg)}`);
    expect(readme).toContain(`(round ${DEFAULT_LAST_ROUND} as standard)`);
    const records = recordMissions(cfg);
    expect(readme).toContain(`with no claim: ${joinWords([...records.public, ...records.secret])}.`);
    const hold = (pace: 'live' | 'correspondence') => durationText(cfg.holdMinutes[pace] * 60_000);
    expect(readme).toContain(`wait at least ${hold('correspondence')}, or ${hold('live')} live`);
  });

  it('carries none of the scoring the game no longer plays', () => {
    expect(readme).not.toMatch(/The first to 7 points wins|Points are never lost|title or two/);
  });
});
