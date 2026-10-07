'use client';

import type { TerritoryId, WarView } from '@empire/rules';
import { useId, useMemo } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { outcomeLines, mateLines, stakesText, warOutlook, type EndingView, type OutcomeLine } from '@/lib/outcomes';
import { useIsDesktop } from '@/lib/use-media-query';
import { findMission, titleOf } from '@/lib/victory';
import { playerName } from '@/lib/wars';

const TONE_TEXT: Record<OutcomeLine['tone'], string> = {
  good: 'text-paper',
  bad: 'text-[#ef7b72]',
  even: 'text-muted',
};

const MARK: Record<OutcomeLine['kind'], string> = {
  victory: '★',
  title: '◆',
  scores: '✓',
  claim: '◇',
  breaks: '✕',
  reveal: '!',
  points: '=',
  progress: '·',
};

/**
 * What a war could change: each ending of the game on the terms as they stand (won, lost, drawn by
 * the campaign's draw rule), the other ways it can end now, what could still change before the
 * game, and why none of it is certain yet. On phones (or `compact`), mission progress and what
 * could still change fold away, so each ending stays a few lines.
 */
export function WarOutcomes({
  model,
  war,
  stake,
  compact,
  heading = 'What this war changes',
}: {
  model: CampaignModel;
  war: WarView;
  /** The stake being built, in place of the war's: declaring, or meeting a raise. */
  stake?: readonly TerritoryId[];
  compact?: boolean;
  heading?: string;
}) {
  const desktop = useIsDesktop();
  const fold = compact ?? !desktop;
  const outlook = useMemo(() => warOutlook(model, war, { stake }), [model, war, stake]);
  const headingId = useId();
  if (!outlook) return null;
  const { current, alternatives, later, provisional, heldUp } = outlook;
  const laterList = (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
      {later.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="label">
        {heading}
      </h3>
      <ul className="space-y-2">
        {current.map((e) => (
          <Ending key={e.key} model={model} ending={e} fold={fold} />
        ))}
      </ul>
      {alternatives.length > 0 && (
        <div className="space-y-2">
          <h4 className="label">Or, without the game</h4>
          <ul className="space-y-2">
            {alternatives.map((e) => (
              <Ending key={e.key} model={model} ending={e} fold={fold} />
            ))}
          </ul>
        </div>
      )}
      {heldUp.length > 0 && (
        <p className="text-sm">
          <span className="font-semibold">While it lasts,</span> this war holds up{' '}
          {heldUp
            .map((c) => {
              const played = findMission(model, c.userId, c.missionKey);
              const whose = c.userId === model.me.userId ? 'your' : `${playerName(model, c.userId)}’s`;
              return `${whose} claim on ${played ? titleOf(played.mission) : 'a mission'}`;
            })
            .join(' and ')}
          : a claim can’t score while a war could still break it.
        </p>
      )}
      {later.length > 0 &&
        (fold ? (
          <details className="text-sm">
            <summary className="min-h-9 cursor-pointer content-center text-muted">
              What could still change ({later.length})
            </summary>
            {laterList}
          </details>
        ) : (
          <div>
            <h4 className="label mb-1">What could still change</h4>
            {laterList}
          </div>
        ))}
      {(provisional.length > 0 || outlook.missionsUnknown) && (
        <p className="text-xs text-muted">
          <span className="font-bold tracking-wide uppercase">Provisional.</span> {provisional.join(' ')}
          {outlook.missionsUnknown && ' Missions can’t be previewed right now: only the map, titles and points are.'}
        </p>
      )}
    </section>
  );
}

function Ending({ model, ending, fold }: { model: CampaignModel; ending: EndingView; fold: boolean }) {
  const lines = ending.projection ? outcomeLines(model, ending.projection) : [];
  const major = lines.filter((l) => l.weight === 'major');
  const minor = lines.filter((l) => l.weight === 'minor');
  const mate = ending.projection && ending.byMate ? mateLines(model, ending.projection, ending.byMate) : [];
  const wins = (ending.projection?.winners.length ?? 0) > 0 || (ending.byMate?.winners.length ?? 0) > 0;
  const border =
    ending.tone === 'good' ? 'border-paper/40' : ending.tone === 'bad' ? 'border-grease/50' : 'border-line';
  return (
    <li className={`rounded-[3px] border px-3 py-2 ${wins ? 'border-amber/70 bg-amber/5' : border}`}>
      <p className="text-[0.95rem]">
        <strong className={ending.tone === 'bad' ? 'text-[#ef7b72]' : ending.tone === 'good' ? 'text-paper' : ''}>
          {ending.label}:
        </strong>{' '}
        {ending.summary}
      </p>
      {major.length > 0 && <Lines lines={major} />}
      {minor.length > 0 &&
        (fold ? (
          <details className="mt-1 text-sm">
            <summary className="min-h-8 cursor-pointer content-center text-muted">
              Mission progress ({minor.length})
            </summary>
            <Lines lines={minor} />
          </details>
        ) : (
          <Lines lines={minor} />
        ))}
      {mate.length > 0 && (
        <div className="mt-1 text-sm">
          <span className="text-muted">Won by checkmate, also:</span>
          <Lines lines={mate} />
        </div>
      )}
    </li>
  );
}

function Lines({ lines }: { lines: OutcomeLine[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-sm">
      {lines.map((l) => (
        <li
          key={l.text}
          className={`flex gap-1.5 ${l.kind === 'victory' ? 'font-semibold text-amber' : TONE_TEXT[l.tone]}`}
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-center">
            {MARK[l.kind]}
          </span>
          <span className="min-w-0">{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Could win the campaign for you", called out beside a war or its game. */
export function WarStakesNote({
  model,
  war,
  className = '',
}: {
  model: CampaignModel;
  war: WarView;
  className?: string;
}) {
  const text = useMemo(() => stakesText(model, war), [model, war]);
  if (!text) return null;
  return (
    <span className={`font-semibold text-amber ${className}`}>
      <span aria-hidden="true">★ </span>
      {text}
    </span>
  );
}
