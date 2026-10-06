'use client';

import {
  TITLE_KINDS,
  claimEligibleRound,
  empireColor,
  holdsByTurns,
  missionRules,
  stakeFloor,
  type CampaignRules,
} from '@empire/rules';
import type { ReactNode } from 'react';
import { holdTimeText } from '@/lib/rules-text';
import { SAMPLE_BATTLE, sampleEmpire } from '@/lib/sample-campaign';
import { EmpireSwatch } from '../hatch';
import { AMBER, Country, GREASE, Sheet, WarArrow, path, polygon, type Point } from '../landing/step-art';
import { TitleToken } from '../victory/title-tokens';

/*
 * The rules guide's pictures, drawn in the map room's marks like the landing page's, with their
 * numbers taken from the page's rules so a campaign's own page stays true to its settings. Each one
 * says what it shows in words beside it, so the drawings themselves are hidden from screen readers.
 */

// ---------------------------------------------------------------------------------------------
// What changes hands

/** The example war's target value, as the stake example in "Declaring war" uses. */
const TARGET_VALUE = 6;
/** The connected country in the example stake, also as in "Declaring war". */
const PARTNER_VALUE = 2;

type Side = 'attacker' | 'defender';
type Place = 'spare' | 'partner' | 'launch' | 'rival' | 'target';

/**
 * Five countries: the attacker's on the left (the country attacked from, a connected one staked
 * with it, and one left out of the stake), the defender's on the right (the target, and another).
 */
const MAP: Record<Place, Point[]> = {
  spare: polygon('8,12 58,6 62,48 10,52'),
  partner: polygon('10,52 62,48 64,90 14,94'),
  launch: polygon('58,6 104,14 102,50 100,88 64,90 62,48'),
  rival: polygon('104,14 152,10 150,46 102,50'),
  target: polygon('102,50 150,46 148,92 100,88'),
};
const PLACES = Object.keys(MAP) as Place[];
const BEFORE: Record<Place, Side> = {
  spare: 'attacker',
  partner: 'attacker',
  launch: 'attacker',
  rival: 'defender',
  target: 'defender',
};
const STAKE: Place[] = ['launch', 'partner'];

interface Outcome {
  title: string;
  text: string;
  /** Countries that change hands, and to whom. */
  moved: Place[];
  to?: Side;
  /** The war as declared: its stake, target and arrow. */
  declared?: boolean;
}

/**
 * One war, declared and then ended each way it can end, on the same five countries: the attacker
 * takes the target, or the defender the whole stake (and nothing else), or a draw. The stake is the
 * least the campaign allows against a target worth 6.
 */
export function WarOutcomesArt({ rules }: { rules: CampaignRules }) {
  const { war } = rules;
  const stake = stakeFloor(rules, TARGET_VALUE);
  const values: Record<Place, number> = {
    spare: 4,
    partner: PARTNER_VALUE,
    launch: Math.max(1, stake - PARTNER_VALUE),
    rival: 3,
    target: TARGET_VALUE,
  };
  const outcomes: Outcome[] = [
    {
      title: 'Declared',
      text: `A stake of ${values.launch + values.partner} against a target worth ${TARGET_VALUE}.`,
      moved: [],
      declared: true,
    },
    {
      title: 'Attacker wins',
      text:
        war.raise === 'matched'
          ? 'The attacker takes the target, and any country a raise put in.'
          : 'The attacker takes the target.',
      moved: ['target'],
      to: 'attacker',
    },
    {
      title: 'Defender wins',
      text: 'The defender takes the whole stake, and nothing else.',
      moved: STAKE,
      to: 'defender',
    },
    {
      title: 'Draw',
      text: war.draws === 'armageddon' ? 'One more game, an Armageddon, decides it.' : 'Nothing changes hands.',
      moved: [],
    },
  ];
  const colors: Record<Side, number> = {
    attacker: sampleEmpire(SAMPLE_BATTLE.attackerId).member.color,
    defender: sampleEmpire(SAMPLE_BATTLE.defenderId).member.color,
  };
  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">What changes hands when a war ends</figcaption>
      <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <li className="flex items-center gap-1.5">
          <EmpireSwatch color={colors.attacker} size={14} /> Attacker
        </li>
        <li className="flex items-center gap-1.5">
          <EmpireSwatch color={colors.defender} size={14} /> Defender
        </li>
        <li className="flex items-center gap-1.5">
          <Mark stroke={AMBER} dashed /> Stake
        </li>
        <li className="flex items-center gap-1.5">
          <Mark stroke={GREASE} /> Target
        </li>
        <li className="flex items-center gap-1.5">
          <Mark stroke={AMBER} /> Changed hands
        </li>
      </ul>
      <ol role="list" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {outcomes.map((o) => {
          const owner = (place: Place) => (o.moved.includes(place) ? o.to! : BEFORE[place]);
          return (
            <li key={o.title} className="overflow-hidden rounded-[3px] border border-line">
              <div aria-hidden="true" className="aspect-[8/5] border-b border-line bg-sea">
                <Sheet colors={[colors.attacker, colors.defender]} width={160} height={100}>
                  {(fill) => (
                    <>
                      {PLACES.map((place) => (
                        <Country
                          key={place}
                          points={MAP[place]}
                          color={colors[owner(place)]}
                          hatch={fill(colors[owner(place)])}
                          value={values[place]}
                        />
                      ))}
                      {o.declared && (
                        <>
                          {STAKE.map((place) => (
                            <path
                              key={place}
                              d={path(MAP[place])}
                              fill="rgba(227,169,43,0.18)"
                              stroke={AMBER}
                              strokeWidth={1.8}
                              strokeDasharray="5 3"
                            />
                          ))}
                          <path d={path(MAP.target)} fill="rgba(200,55,45,0.2)" stroke={GREASE} strokeWidth={2} />
                          <WarArrow from={[84, 30]} to={[122, 60]} bow={10} />
                        </>
                      )}
                      {o.moved.map((place) => (
                        <path
                          key={place}
                          d={path(MAP[place])}
                          fill="rgba(227,169,43,0.16)"
                          stroke={AMBER}
                          strokeWidth={2.2}
                          strokeLinejoin="round"
                        />
                      ))}
                    </>
                  )}
                </Sheet>
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[0.95rem] font-bold">{o.title}</p>
                <p className="text-sm leading-snug text-muted">{o.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/** A small outlined square, as the pictures outline countries. */
function Mark({ stroke, dashed = false }: { stroke: string; dashed?: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x={1.5}
        y={1.5}
        width={11}
        height={11}
        rx={1.5}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={dashed ? '3 2' : undefined}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Points and claims

type Slot = 'mission' | 'title' | 'claim' | 'empty';

const SLOT_CLASS: Record<Slot, string> = {
  mission: 'border-amber bg-amber',
  title: 'border-amber bg-amber/20',
  claim: 'border-dashed border-amber/80',
  empty: 'border-line-strong',
};

/**
 * A player's race to the points to win: mission points scored (permanent), a title held
 * (transferable, from version 5), and a claim waiting to score (not counted yet), slot by slot.
 */
export function PointsArt({ rules }: { rules: CampaignRules }) {
  const { points, titles } = missionRules(rules.victory.version);
  const title = titles?.points ?? 0;
  const claim = points.public;
  // A public mission scored, the secret too while that leaves room, a title held, and a claim waiting.
  const secret = points.public + points.secret + title + claim < points.toWin ? points.secret : 0;
  const missions = points.public + secret;
  const counted = missions + title;
  const toGo = Math.max(0, points.toWin - counted - claim);
  const slots: Slot[] = [
    ...Array<Slot>(missions).fill('mission'),
    ...Array<Slot>(title).fill('title'),
    ...Array<Slot>(claim).fill('claim'),
    ...Array<Slot>(toGo).fill('empty'),
  ];
  const scored = secret > 0 ? 'a public mission and the secret' : 'a public mission';
  return (
    <figure className="space-y-2 rounded-[3px] border border-line p-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span>
          <strong className="tabular-nums">{counted}</strong> of {points.toWin} points count
        </span>
        <span className="font-bold text-amber tabular-nums">{points.toWin} to win</span>
      </figcaption>
      <div aria-hidden="true" className="flex gap-1">
        {slots.map((slot, i) => (
          <span
            key={i}
            className={`flex h-7 min-w-0 flex-1 items-center justify-center rounded-[2px] border-2 ${SLOT_CLASS[slot]}`}
          >
            {slot === 'title' && <TitleToken kind={TITLE_KINDS[0]} size={18} label={false} />}
          </span>
        ))}
      </div>
      <ul role="list" className="space-y-1 text-sm">
        <PointsKey slot="mission">
          <strong>Mission points, {missions}:</strong> {scored}, scored and yours for good.
        </PointsKey>
        {title > 0 && (
          <PointsKey slot="title">
            <strong>A title, {title}:</strong> counted while you lead, gone when someone passes you.
          </PointsKey>
        )}
        <PointsKey slot="claim">
          <strong>A claim, {claim}:</strong> a position completed but not yet held long enough. It counts once it
          scores.
        </PointsKey>
      </ul>
    </figure>
  );
}

function PointsKey({ slot, children }: { slot: Slot; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={`mt-1 size-3.5 shrink-0 rounded-[2px] border-2 ${SLOT_CLASS[slot]}`} />
      <span>{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// When a claim scores

/** The round the example claim is made in, as the claim rules' own example has it. */
const CLAIM_ROUND = 3;

/**
 * A position completed in round 3, held, and scoring in the first round it can, next to a record
 * (and, from version 5, a title) that counts the moment it happens.
 */
export function ClaimTimelineArt({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { points, titles } = missionRules(rules.victory.version);
  const scores = claimEligibleRound(CLAIM_ROUND);
  const rounds = Array.from({ length: scores - CLAIM_ROUND + 1 }, (_, i) => CLAIM_ROUND + i);
  const held = holdsByTurns(rules)
    ? 'Held while every player takes their turns to declare war'
    : `Held for at least ${holdTimeText(rules, standard)} after round ${CLAIM_ROUND + 1} starts`;
  const cell = 'rounded-[3px] border-2 px-2 py-1.5 text-sm leading-snug';
  const waiting = `${cell} border-dashed border-amber/80`;
  const counts = `${cell} border-amber bg-amber/15 font-semibold`;
  const roundOf = (round: number) => <span className="sr-only">Round {round}: </span>;
  return (
    <figure className="space-y-2 rounded-[3px] border border-line p-3">
      <figcaption className="sr-only">
        When a position, a record{titles ? ' and a title' : ''} count toward your points
      </figcaption>
      <div className="grid gap-x-2 gap-y-2" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(0, 1fr))` }}>
        {rounds.map((round) => (
          <div key={round} aria-hidden="true" className="label border-b border-line-strong pb-1">
            Round {round}
          </div>
        ))}
        <p className="col-span-full pt-1 text-sm font-bold">A position</p>
        {rounds.map((round, i) => (
          <div key={round} className={i === rounds.length - 1 ? counts : waiting}>
            {roundOf(round)}
            {i === 0
              ? 'Completed: the claim starts'
              : i === rounds.length - 1
                ? `Scores ${points.public} points, at the earliest`
                : held}
          </div>
        ))}
        <p className="col-span-full pt-1 text-sm font-bold">{titles ? 'A record, or a title' : 'A record'}</p>
        <div className={counts}>
          {roundOf(CLAIM_ROUND)}
          {titles ? 'Counts at once' : 'Scores at once'}
        </div>
      </div>
      <p className="text-sm text-muted">
        Lose the position before it scores and the claim ends, with nothing scored. The example scores {points.public}{' '}
        for a public mission; a secret scores {points.secret}.
      </p>
    </figure>
  );
}
