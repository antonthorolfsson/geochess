'use client';

import type { CampaignRules, ChessProfile, GameEndReason, PlayerResult, ResultTally } from '@empire/rules';
import Link from 'next/link';
import { useState } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { relativeTime } from '@/lib/format';
import { endingText, playerName, reasonText } from '@/lib/wars';

const RESULTS: PlayerResult[] = ['won', 'drawn', 'lost'];
const RESULT_WORD: Record<PlayerResult, string> = { won: 'Won', drawn: 'Drawn', lost: 'Lost' };

/** The campaign's pace, e.g. "Live games, 5+3" or "Correspondence, 1 day per move". */
function paceText(rules: CampaignRules): string {
  const { pace, liveClock, hoursPerMove } = rules.war;
  if (pace === 'live') return `Live games, ${liveClock}`;
  const days = hoursPerMove / 24;
  const per = Number.isInteger(days) ? `${days} ${days === 1 ? 'day' : 'days'}` : `${hoursPerMove} hours`;
  return `Correspondence, ${per} per move`;
}

const sum = (a: ResultTally, b: ResultTally): ResultTally => ({
  won: a.won + b.won,
  drawn: a.drawn + b.drawn,
  lost: a.lost + b.lost,
});
const gamesIn = (t: ResultTally) => t.won + t.drawn + t.lost;

/** Games played in this campaign: results by colour, how they ended, openings and the games themselves. */
export function ChessProfileView({
  model,
  profile,
  userId,
}: {
  model: CampaignModel;
  profile: ChessProfile;
  userId: string;
}) {
  const member = model.membersById.get(userId);
  const total = sum(profile.asWhite, profile.asBlack);
  const lichess = member?.lichessUsername;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {paceText(model.campaign.rules)}
        {profile.underway > 0 && ` · ${profile.underway} ${profile.underway === 1 ? 'game' : 'games'} underway`}
        {lichess && (
          <>
            {' · '}
            <a
              href={`https://lichess.org/@/${encodeURIComponent(lichess)}`}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-line-strong underline-offset-2 hover:text-paper"
            >
              {lichess} on Lichess
            </a>
          </>
        )}
      </p>
      {profile.played === 0 ? (
        <p className="text-[0.95rem] text-muted">No games finished yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-4 gap-x-4">
            {(
              [
                ['Games', profile.played],
                ['Won', total.won],
                ['Drawn', total.drawn],
                ['Lost', total.lost],
              ] as const
            ).map(([label, n]) => (
              <div key={label}>
                <dt className="label">{label}</dt>
                <dd className="text-2xl font-semibold">{n}</dd>
              </div>
            ))}
          </dl>

          <table className="w-full text-[0.95rem] tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  Colour
                </th>
                {['Games', ...RESULTS.map((r) => RESULT_WORD[r])].map((h) => (
                  <th key={h} scope="col" className="label pb-1 pl-3 text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(
                [
                  ['As White', profile.asWhite],
                  ['As Black', profile.asBlack],
                ] as const
              ).map(([label, t]) => (
                <tr key={label}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {label}
                  </th>
                  <td className="py-1.5 pl-3 text-right font-semibold">{gamesIn(t)}</td>
                  {RESULTS.map((r) => (
                    <td key={r} className="py-1.5 pl-3 text-right">
                      {t[r]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <Endings endings={profile.endings} />
          {profile.averageMoves !== null && (
            <p className="text-[0.95rem]">Games last {Math.round(profile.averageMoves)} moves on average.</p>
          )}
          <Openings profile={profile} />
          <Games model={model} profile={profile} />
        </>
      )}
    </div>
  );
}

function Endings({ endings }: { endings: ChessProfile['endings'] }) {
  const lines = RESULTS.flatMap((result) => {
    const parts = (Object.entries(endings) as [GameEndReason, ResultTally][])
      .filter(([, t]) => t[result] > 0)
      .sort((a, b) => b[1][result] - a[1][result])
      .map(([reason, t]) => `${reasonText(reason)} ${t[result]}`);
    return parts.length ? [{ result, parts }] : [];
  });
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="label mb-1">How games ended</h3>
      <ul className="space-y-0.5 text-[0.95rem]">
        {lines.map(({ result, parts }) => (
          <li key={result}>
            <span className="font-semibold">{RESULT_WORD[result]}</span> {parts.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TOP_OPENINGS = 5;

function Openings({ profile }: { profile: ChessProfile }) {
  const sides = (['white', 'black'] as const).map((color) => ({
    color,
    list: profile.openings.filter((o) => o.color === color).slice(0, TOP_OPENINGS),
  }));
  if (sides.every((s) => s.list.length === 0)) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sides.map(({ color, list }) =>
        list.length === 0 ? null : (
          <div key={color} className="min-w-0">
            <h3 className="label mb-1">Openings as {color === 'white' ? 'White' : 'Black'}</h3>
            <ul className="space-y-1 text-[0.95rem]">
              {list.map((o) => (
                <li key={o.family} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{o.family}</span>
                  <span className="shrink-0 text-sm text-muted tabular-nums">
                    {RESULTS.filter((r) => o[r] > 0)
                      .map((r) => `${o[r]} ${r}`)
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}

const RECENT_GAMES = 6;

function Games({ model, profile }: { model: CampaignModel; profile: ChessProfile }) {
  const [all, setAll] = useState(false);
  const shown = all ? profile.games : profile.games.slice(0, RECENT_GAMES);
  return (
    <div>
      <h3 className="label mb-2">Games</h3>
      <ul className="divide-y divide-line rounded-[3px] border border-line">
        {shown.map((g) => (
          <li key={g.gameId}>
            <Link
              href={`/c/${model.campaign.id}?game=${g.gameId}`}
              className="flex min-h-11 items-center gap-3 px-3 py-1.5 hover:bg-raised"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <span className={g.result === 'won' ? 'font-semibold' : 'text-muted'}>
                    {endingText(g.result, g.reason)}
                  </span>{' '}
                  vs {playerName(model, g.opponentId)}
                  {g.armageddon && <span className="text-muted"> · Armageddon</span>}
                </span>
                <span className="block truncate text-sm text-muted">
                  {g.color === 'white' ? 'White' : 'Black'} · {g.opening?.name ?? 'No opening named'} · {g.moves}{' '}
                  {g.moves === 1 ? 'move' : 'moves'}
                </span>
              </span>
              {g.finishedAt && (
                <span className="shrink-0 text-xs text-faint tabular-nums">{relativeTime(g.finishedAt)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {profile.games.length > RECENT_GAMES && (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${profile.games.length}`}
        </button>
      )}
    </div>
  );
}
