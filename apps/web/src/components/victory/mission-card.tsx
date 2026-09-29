'use client';

import {
  missionInfo,
  missionTargets,
  partAmount,
  type MissionView,
  type ProgressPart,
  type TerritoryId,
} from '@empire/rules';
import type { ReactNode } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { requirementText } from '@/lib/victory';

/** Victory points as a stamped figure: "2 VP". */
export function PointsBadge({ points, className = '' }: { points: number; className?: string }) {
  return (
    <span
      title={`${points} victory ${points === 1 ? 'point' : 'points'}`}
      className={`inline-flex h-7 shrink-0 items-center rounded-[3px] border border-amber/70 px-1.5 text-sm font-bold whitespace-nowrap text-amber tabular-nums ${className}`}
    >
      {points} VP
    </span>
  );
}

/**
 * The requirements of a mission, one line each with how far along they are. Missions with several
 * requirements show each; nothing is boiled down to a single percentage.
 */
export function ProgressParts({ parts, label }: { parts: ProgressPart[]; label: string }) {
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {parts.map((p) => {
        const share = p.need > 0 ? Math.max(0, Math.min(1, p.have / p.need)) : 1;
        return (
          <li key={p.label} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={`inline-flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded-[2px] border text-[0.65rem] font-bold ${
                  p.done ? 'border-amber bg-amber text-gunmetal' : 'border-line-strong'
                }`}
              >
                {p.done ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">{p.label}</span>
              <span className="font-semibold tabular-nums">
                {partAmount(p, p.have)} <span className="font-normal text-muted">of</span> {partAmount(p, p.need)}
                <span className="sr-only">{p.done ? ', done' : ', not yet'}</span>
              </span>
            </div>
            <div className="mt-1 ml-6 h-1 rounded-full bg-line" aria-hidden="true">
              <div
                className={`h-1 rounded-full ${p.done ? 'bg-amber' : 'bg-paper/60'}`}
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The countries a mission names, as buttons that find them on the map. */
export function TargetChips({
  model,
  ids,
  held,
  onSelectCountry,
}: {
  model: CampaignModel;
  ids: readonly TerritoryId[];
  /** Targets to mark as counting now. */
  held?: ReadonlySet<TerritoryId>;
  onSelectCountry(id: TerritoryId): void;
}) {
  if (ids.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Targets">
      {ids.map((id) => {
        const t = model.idx.byId.get(id);
        const counts = held?.has(id) ?? false;
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelectCountry(id)}
              className={`inline-flex min-h-8 items-center gap-1 rounded-[3px] border px-2 text-sm hover:bg-raised ${
                counts ? 'border-paper/70 bg-paper/10' : 'border-line'
              }`}
            >
              {t?.name ?? id}
              <span className="text-xs text-muted tabular-nums">{t?.value}</span>
              {counts && <span className="sr-only"> (held)</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A mission as a briefing card: its name, points and exact requirement, then whatever follows. */
export function MissionCard({
  model,
  mission,
  onSelectCountry,
  onShowOnMap,
  held,
  highlight = false,
  children,
}: {
  model: CampaignModel;
  mission: Pick<MissionView, 'points' | 'spec' | 'scope'>;
  onSelectCountry(id: TerritoryId): void;
  onShowOnMap?(): void;
  held?: ReadonlySet<TerritoryId>;
  /** Drawn in amber: the viewer's own secret mission. */
  highlight?: boolean;
  children?: ReactNode;
}) {
  const info = missionInfo(mission.spec.kind);
  const tags = [
    mission.scope === 'secret' ? 'Secret' : 'Public',
    info.timing === 'historic' ? 'Scores the moment it’s done' : 'Hold it to score',
    ...(info.long ? ['Long campaign'] : []),
  ];
  return (
    <article
      className={`space-y-2.5 rounded-[3px] border bg-panel p-3 ${highlight ? 'border-amber/60' : 'border-line'}`}
      aria-label={info.name}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-stencil text-xl leading-tight tracking-wide">{info.name}</h3>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{tags.join(' · ')}</p>
        </div>
        <PointsBadge points={mission.points} />
      </header>
      <p className="text-[0.95rem] leading-snug">{requirementText(model, mission.spec)}</p>
      <TargetChips
        model={model}
        // Encirclement names its center too, but only the ring is to be held.
        ids={mission.spec.kind === 'encirclement' ? mission.spec.ring : missionTargets(mission.spec)}
        held={held}
        onSelectCountry={onSelectCountry}
      />
      {children}
      {onShowOnMap && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onShowOnMap}>
          Show on map
        </button>
      )}
    </article>
  );
}
