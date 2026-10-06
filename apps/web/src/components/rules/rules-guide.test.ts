import { DEFAULT_RULES, parseRules, type CampaignRules, type PublicMissionSpec } from '@empire/rules';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RulesGuide, type RulesGuideProps } from './rules-guide';

/** The page as a reader gets it: the markup, and its words without the tags. */
function render(props: RulesGuideProps): { html: string; text: string } {
  const html = renderToStaticMarkup(createElement(RulesGuide, props));
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:)])/g, '$1');
  return { html, text };
}

const campaign = (rules: CampaignRules, datasetVersion = '2026.3'): RulesGuideProps => ({
  variant: 'campaign',
  rules,
  datasetVersion,
  settingsNote: 'Picked in the lobby.',
});

/** A campaign's public missions, as the lobby stores them. */
const MISSIONS: PublicMissionSpec[] = [
  { kind: 'expansion', gain: 22 },
  { kind: 'campaign_veteran', wins: 4, opponents: 3, attackWins: 4, attackOnly: true },
];

/** Every section's anchor, which links from other pages (`/rules#answers`) and from the guide use. */
const SECTIONS = ['idea', 'campaign', 'rounds', 'declaring', 'answers', 'battle', 'after', 'ending'];
const MORE = ['diplomacy', 'bots', 'deadlines', 'settings'];

const standard = render({ variant: 'standard' });

describe('the rules guide', () => {
  it('keeps every anchor, and links each section from the contents', () => {
    for (const id of [...SECTIONS, ...MORE, 'fortifying', 'raising', 'peace', 'quick-start']) {
      expect(standard.html).toContain(`id="${id}"`);
    }
    for (const id of [...SECTIONS, ...MORE, 'quick-start']) expect(standard.html).toContain(`href="#${id}"`);
    // Winning's parts have anchors of their own.
    for (const id of ['points', 'scoring', 'public-missions', 'secret-missions', 'claims', 'titles', 'last-round']) {
      expect(standard.html).toContain(`id="${id}"`);
      expect(standard.html).toContain(`href="#${id}"`);
    }
    // The quick start comes before the complete rules, on both pages.
    expect(standard.html.indexOf('id="quick-start"')).toBeLessThan(standard.html.indexOf('id="idea"'));
    const own = render(campaign(DEFAULT_RULES)).html;
    expect(own.indexOf('id="quick-start"')).toBeLessThan(own.indexOf('id="settings"'));
  });

  it('starts beginners with winning, the draft, one war, its game and what changes hands', () => {
    const { text } = standard;
    const quick = text.slice(text.indexOf('Quick start Contents'), text.indexOf('The complete rules Every rule'));
    for (const step of [
      'How to win',
      'Draft an empire',
      'Declare one war',
      'Play the chess game',
      'Take the territory',
    ]) {
      expect(quick).toContain(step);
    }
    // Numbers from the rules new campaigns start with, and both paces where they differ.
    expect(quick).toContain('The first to 10 wins on the spot; if nobody has when round 25 ends, the most points win');
    expect(quick).toContain('at least 110% of the target');
    expect(quick).toContain('24 hours (5 minutes in live campaigns) to answer');
    expect(quick).toContain('1 day for each move as standard; live campaigns play blitz at 5+3');
    expect(quick).toContain('If the attacker wins, they take the target');
  });

  it('tells permanent mission points, pending claims and transferable titles apart', () => {
    expect(standard.text).toContain('Mission points Permanent');
    expect(standard.text).toContain('Pending claims Not points yet');
    expect(standard.text).toContain('Title points Transferable');
    expect(standard.text).toContain("A claim waiting to score isn't a point yet.");
  });

  it('says which missions score at once, which wait, and that a title can win on the spot', () => {
    expect(standard.text).toContain(
      'At once: records. Campaign Veteran, Kingslayer, Lightning Campaign, Backstab, Iron Wall and Checkmate Artist are records',
    );
    expect(standard.text).toContain('At once: titles.');
    expect(standard.text).toContain('Taking one can win the campaign on the spot');
    expect(standard.text).toContain(
      'After holding: positions. Every other mission is a position to hold. Completing one starts a claim, which scores once the round after next has started and every player has had their turns',
    );
  });

  it('describes both ways to win', () => {
    expect(standard.text).toContain('A campaign is won one of two ways');
    expect(standard.text).toContain(
      'The first to 10 victory points wins at once: the moment a mission scores for them or a title moves to them',
    );
    expect(standard.text).toContain(
      'If nobody has reached 10 when the host moves on from round 25, the campaign ends anyway: the most victory points win, then the largest population, then the most land, then the largest GDP.',
    );
  });

  it('never says a title is required when missions alone can reach the target', () => {
    expect(standard.text).toContain('Missions alone can make 11 points');
    expect(standard.text).toContain('so no title is ever required');
    expect(standard.text).not.toMatch(/a winner holds a title|title or two as well/);
    expect(standard.text).not.toContain('Points are never taken away');
    expect(standard.text).not.toContain('most valuable empire');
  });

  it('gives both paces’ deadlines on the standard page', () => {
    expect(standard.html).toMatch(/>Correspondence<\/th>.*>Live<\/th>/s);
    expect(standard.text).toContain('A player chooses a secret mission 24 hours 5 minutes');
    expect(standard.text).toContain('A player moves 1 day per move On the clock, 5+3');
    expect(standard.text).toContain('chooses one within 24 hours (5 minutes in live campaigns)');
    expect(standard.text).toContain('who has 24 hours (5 minutes in live campaigns) to reply');
  });

  it('quotes a live campaign’s own times, and never the correspondence ones', () => {
    const live = render(campaign({ ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, pace: 'live', liveClock: '10+5' } }));
    expect(live.text).not.toMatch(/24 hours|1 day|in live campaigns|in correspondence campaigns/);
    expect(live.text).toContain('The defender has 5 minutes to answer');
    expect(live.text).toContain('chooses one within 5 minutes');
    expect(live.text).toContain('A player moves On the clock, 10+5');
    expect(live.text).toContain('One game of blitz at 10+5 decides the war');
  });

  it('follows a campaign’s alternate settings', () => {
    const rules = parseRules({
      war: { pace: 'live', turns: false },
      victory: {
        mode: 'objectives',
        version: 6,
        publicMissions: MISSIONS,
        lastRound: null,
        hold: 'turns',
        holdMinutes: 30,
        selectionMinutes: 10,
        tiebreak: 'realWorld',
      },
    });
    const { html, text } = render(campaign(rules));
    // Without turns, claims are held for the host's time instead.
    expect(text).toContain('at least 30 minutes have passed since the next round started');
    expect(text).toContain('chooses one within 10 minutes');
    // No last round: one way to win.
    expect(text).toContain('This campaign is won one way');
    expect(text).not.toContain('Lead after round');
    expect(text).toContain('This campaign has no last round: it goes on until someone reaches 10');
    expect(text).toContain('This campaign plays Expansion and Campaign Veteran');
    // The original answers stored rules read as.
    expect(text).toContain('pay tribute');
    expect(text).not.toContain('Raising back and forth');
  });

  it('describes a campaign stored before titles by its own mission rules', () => {
    const rules = parseRules({ victory: { mode: 'objectives', version: 4, publicMissions: MISSIONS, lastRound: 20 } });
    const { html, text } = render(campaign(rules, '2026.2'));
    expect(text).toContain(
      'This campaign plays mission rules version 4, which it was created with (7 points to win, no titles)',
    );
    expect(text).toContain('The first to 7 wins on the spot; if nobody has when round 20 ends, the most points win');
    expect(text).toContain('Two public missions and the secret make 7, and all four public ones make 8');
    // Its tiebreak is the one it was stored with.
    expect(text).toContain('the most victory points win, then the most valuable empire');
    expect(text).not.toMatch(/Title points|title moves|At once: titles|Largest Population/);
    expect(html).not.toContain('id="titles"');
    // Claims held for a time, as stored campaigns hold them.
    expect(text).toContain('at least 24 hours have passed since the next round started');
  });

  it('describes a campaign stored before victory missions as open-ended', () => {
    const { html, text } = render(campaign(parseRules({}), '2026.1'));
    expect(text).toContain('This campaign is open-ended: no points and no fixed end');
    expect(text).toContain('no victory points, missions or titles, and no fixed end');
    expect(text).not.toMatch(/Mission points|Pending claims|first to \d+/);
    expect(html).not.toContain('id="points"');
    expect(text).toContain('Each is worth 1 to 10');
    expect(text).toContain('build a stake worth at least 80% of the target');
  });

  it('shows the version note only where a campaign’s mission rules differ', () => {
    expect(standard.text).not.toContain('mission rules version');
    expect(render(campaign(DEFAULT_RULES)).text).not.toContain('mission rules version');
  });
});

describe('the rules guide’s pictures', () => {
  it('shows what changes hands, with the least stake the rules allow', () => {
    expect(standard.text).toContain('Declared A stake of 7 against a target worth 6.');
    expect(standard.text).toContain('Attacker wins The attacker takes the target, and any country a raise put in.');
    expect(standard.text).toContain('Defender wins The defender takes the whole stake, and nothing else.');
    expect(standard.text).toContain('Draw Nothing changes hands.');
    // The drawings only illustrate the captions beside them.
    expect(standard.html).toMatch(/<div aria-hidden="true" class="aspect-\[8\/5\][^"]*"><svg/);
  });

  it('shows the three kinds of points in a race to the target', () => {
    expect(standard.text).toContain('6 of 10 points count');
    expect(standard.text).toContain('Mission points, 5: a public mission and the secret, scored and yours for good.');
    expect(standard.text).toContain('A title, 1: counted while you lead');
    expect(standard.text).toContain('A claim, 2: a position completed but not yet held long enough');
  });

  it('shows when a claim scores, beside what counts at once', () => {
    expect(standard.text).toContain('Round 3: Completed: the claim starts');
    expect(standard.text).toContain('Round 4: Held while every player takes their turns to declare war');
    expect(standard.text).toContain('Round 5: Scores 2 points, at the earliest');
    expect(standard.text).toContain('A record, or a title Round 3: Counts at once');
  });

  it('draws a campaign stored before titles with its own numbers', () => {
    const rules = parseRules({ victory: { mode: 'objectives', version: 4, publicMissions: MISSIONS, lastRound: 20 } });
    const { text } = render(campaign(rules, '2026.2'));
    // Stakes of 80% and a free raise, as stored rules read.
    expect(text).toContain('A stake of 5 against a target worth 6.');
    expect(text).toContain('Attacker wins The attacker takes the target. ');
    // No titles: a public mission scored, and a claim waiting, short of 7.
    expect(text).toContain('2 of 7 points count');
    expect(text).not.toContain('A title, 1');
    // Claims held for a time.
    expect(text).toContain('Round 4: Held for at least 24 hours after round 4 starts');
    expect(text).toContain('A record Round 3: Scores at once');
  });

  it('follows the campaign’s draw rule', () => {
    const rules = { ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, draws: 'armageddon' as const } };
    expect(render(campaign(rules)).text).toContain('Draw One more game, an Armageddon, decides it.');
  });

  it('draws no points or claims for an open-ended campaign', () => {
    const { text } = render(campaign(parseRules({}), '2026.1'));
    expect(text).toContain('A stake of 5 against a target worth 6.');
    expect(text).not.toMatch(/points count|the claim starts/);
  });
});
