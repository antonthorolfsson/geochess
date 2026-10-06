'use client';

import { DEFAULT_RULES, lastRoundOf, type Color, type MemberView } from '@empire/rules';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useMemo } from 'react';
import { useMapData } from '@/lib/queries';
import {
  SAMPLE_BATTLE,
  SAMPLE_DATASET,
  SAMPLE_EMPIRES,
  SAMPLE_GAME,
  SAMPLE_ROUND,
  SAMPLE_WARS,
  sampleEmpire,
  sampleOwners,
} from '@/lib/sample-campaign';
import { formatClock } from '@/lib/wars';
import { PlayerName } from '../campaign/player-name';
import { Board } from '../game/board';
import { WorldMap, type MapWar, type MapWarFocus } from '../map/world-map';
import { Notice, Spinner } from '../ui';

const noop = () => {};

/**
 * The landing page's sample campaign, on the game's own map and board: a campaign Geo Chess's bots
 * played, in the round the battle for Italy began. Labelled as sample data on the map and beneath.
 */
export function SampleCampaign() {
  const last = lastRoundOf(DEFAULT_RULES);
  const attacker = sampleEmpire(SAMPLE_BATTLE.attackerId).member.name;
  return (
    <figure className="overflow-hidden rounded-[4px] border border-line-strong bg-panel">
      <div className="grid md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col">
          <div className="relative aspect-[4/3] bg-sea sm:aspect-[16/10] md:aspect-auto md:min-h-[26rem] md:flex-1">
            <SampleMap />
            <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-3 rounded-[3px] bg-gunmetal/90 py-1.5 pr-3 pl-2.5">
              <span className="stamp stamp-sm">Sample</span>
              <span className="text-sm font-bold tracking-wider text-paper uppercase">
                Round {SAMPLE_ROUND}
                {last !== null && <span className="text-muted"> of {last}</span>}
              </span>
            </div>
          </div>
          <ul
            role="list"
            aria-label="Empires in the sample campaign"
            className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-3 py-2"
          >
            {SAMPLE_EMPIRES.map(({ member, countries }) => (
              <li key={member.userId} className="flex min-h-8 items-center gap-2">
                <PlayerName member={member} size="sm" />
                <span className="text-sm text-muted tabular-nums">{countries.length} countries</span>
              </li>
            ))}
          </ul>
        </div>
        <SampleBattle />
      </div>
      <figcaption className="border-t border-line px-4 py-3 text-[0.95rem] leading-relaxed">
        <strong className="text-amber">Sample data, not a real game.</strong>{' '}
        <span className="text-muted">
          Four empires from a campaign Geo Chess’s bots played on the real map, in round {SAMPLE_ROUND}, with {attacker}
          ’s battle for {SAMPLE_BATTLE.target.name} under way. Grease-pencil arrows are wars; {attacker}’s stake is
          outlined in amber and the target in red. Names, clocks and the chess position are made up.
        </span>
      </figcaption>
    </figure>
  );
}

function SampleMap() {
  const map = useMapData(SAMPLE_DATASET);
  const owners = useMemo(sampleOwners, []);
  const wars: MapWar[] = useMemo(
    () => SAMPLE_WARS.map((w) => ({ id: w.id, from: w.launchId, to: w.targetId, threat: w.threat, mine: false })),
    [],
  );
  const focus: MapWarFocus = useMemo(
    () => ({
      id: SAMPLE_BATTLE.warId,
      attacker: SAMPLE_BATTLE.stake.map((s) => s.id),
      defender: [SAMPLE_BATTLE.target.id],
    }),
    [],
  );
  if (!map.data) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-4">
        {map.error ? <Notice tone="error">The sample map didn’t load.</Notice> : <Spinner label="Loading the map" />}
      </div>
    );
  }
  return (
    <div className="absolute inset-0">
      <WorldMap
        still
        topo={map.data.topo}
        dataset={map.data.dataset}
        owners={owners}
        selectedId={null}
        highlighted={null}
        showValues
        onSelect={noop}
        focus={null}
        initialFrame={SAMPLE_BATTLE.frame}
        wars={wars}
        war={focus}
      />
    </div>
  );
}

/** The battle's board as a player sees it: the war game panel, without anything to press. */
function SampleBattle() {
  const attacker = sampleEmpire(SAMPLE_BATTLE.attackerId).member;
  const defender = sampleEmpire(SAMPLE_BATTLE.defenderId).member;
  const { target, stake } = SAMPLE_BATTLE;
  const stakeValue = stake.reduce((sum, s) => sum + s.value, 0);
  const config: Config = useMemo(
    () => ({
      fen: SAMPLE_GAME.fen,
      orientation: 'white',
      turnColor: 'white',
      lastMove: [...SAMPLE_GAME.lastMove] as Key[],
      // A picture of a position: the board's coordinates add nothing to it.
      coordinates: false,
      viewOnly: true,
      animation: { enabled: false },
      drawable: { enabled: false, visible: false },
    }),
    [],
  );
  return (
    <section
      aria-labelledby="sample-battle-heading"
      className="flex flex-col gap-3 border-t border-line p-3 md:border-t-0 md:border-l lg:p-4"
    >
      <div className="mx-auto flex w-full max-w-sm flex-col gap-3 md:max-w-none">
        <header>
          <div className="label">Sample war game</div>
          <h3 id="sample-battle-heading" className="font-stencil text-2xl leading-tight tracking-wide">
            Battle for {target.name}
          </h3>
        </header>
        <Strip member={defender} side="Defender" color="black" clockMs={SAMPLE_GAME.clocks.black} toMove={false} />
        <div
          role="img"
          aria-label={`The game's position: White, the attacker, to move after ${SAMPLE_GAME.moves.length / 2} moves of an Italian Game.`}
          className="relative aspect-square w-full"
        >
          <Board config={config} />
        </div>
        <Strip member={attacker} side="Attacker" color="white" clockMs={SAMPLE_GAME.clocks.white} toMove />
        <p className="text-[0.95rem] text-muted">
          Last move <span className="font-semibold text-paper">{SAMPLE_GAME.lastSan}</span> · White to move
        </p>
        <dl className="divide-y divide-line rounded-[3px] border border-line text-[0.95rem]">
          <div className="flex items-baseline justify-between gap-3 px-3 py-2">
            <dt className="text-muted">{attacker.name} stakes</dt>
            <dd className="text-right">
              {stake.map((s) => `${s.name} ${s.value}`).join(' + ')} ={' '}
              <strong className="tabular-nums">{stakeValue}</strong>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-3 py-2">
            <dt className="text-muted">{defender.name} holds</dt>
            <dd className="text-right">
              {target.name} <strong className="tabular-nums">{target.value}</strong>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/** A player beside the board, with their clock: the war game's strip, standing still. */
function Strip({
  member,
  side,
  color,
  clockMs,
  toMove,
}: {
  member: MemberView;
  side: string;
  color: Color;
  clockMs: number;
  toMove: boolean;
}) {
  const clock = formatClock(clockMs);
  return (
    <div className="flex min-h-12 items-center gap-3">
      <span
        aria-hidden="true"
        className={`size-3.5 shrink-0 rounded-full border border-line-strong ${color === 'white' ? 'bg-paper' : 'bg-gunmetal'}`}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <PlayerName member={member} size="sm" />
        <span className="text-xs font-bold tracking-widest text-muted uppercase">
          {side}, {color}
        </span>
      </span>
      <span
        className={`min-w-[5.5rem] rounded-[3px] px-2 py-1 text-right font-mono text-2xl font-bold tabular-nums ${
          toMove ? 'bg-paper text-gunmetal' : 'bg-raised text-muted'
        }`}
      >
        <span className="sr-only">{member.name}’s clock: </span>
        {clock}
      </span>
    </div>
  );
}
