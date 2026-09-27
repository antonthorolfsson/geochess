'use client';

import type { WarView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { useMyGames } from '@/lib/use-my-games';
import { useNow } from '@/lib/use-now';
import { countryName, playerName, timeLeft, warStatusText } from '@/lib/wars';
import { EmpireSwatch } from '../hatch';
import { NotificationsToggle } from '../notifications';
import { Notice } from '../ui';

/** Round, tokens and every war: what needs an answer, games to play, and the rest. */
export function WarsPanel({
  model,
  onOpenWar,
  onOpenGame,
}: {
  model: CampaignModel;
  onOpenWar(warId: string): void;
  onOpenGame(gameId: string): void;
}) {
  const others = model.activeWars.filter((w) => !model.awaitingMe.includes(w));
  return (
    <div className="space-y-6">
      <RoundStatus model={model} />
      {model.awaitingMe.length > 0 && (
        <section>
          <h2 className="label mb-2 text-amber">Waiting for your answer</h2>
          <WarList model={model} wars={model.awaitingMe} onOpenWar={onOpenWar} highlight />
        </section>
      )}
      <YourGames model={model} onOpenGame={onOpenGame} />
      <section>
        <h2 className="label mb-2">Wars underway</h2>
        {others.length > 0 ? (
          <WarList model={model} wars={others} onOpenWar={onOpenWar} />
        ) : (
          <p className="text-[0.95rem] text-muted">
            {model.targets.size > 0
              ? `No wars underway. ${model.targets.size} enemy ${model.targets.size === 1 ? 'country borders' : 'countries border'} your empire: pick one on the map to declare war.`
              : 'No wars underway.'}
          </p>
        )}
      </section>
      {model.pastWars.length > 0 && (
        <section>
          <h2 className="label mb-2">Recent wars</h2>
          <WarList model={model} wars={model.pastWars.slice(0, 12)} onOpenWar={onOpenWar} />
        </section>
      )}
    </div>
  );
}

function RoundStatus({ model }: { model: CampaignModel }) {
  const { campaign, isHost } = model;
  const queryClient = useQueryClient();
  const next = useMutation({
    mutationFn: () => api.nextRound(campaign.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) }),
  });
  const { rules } = campaign;
  const pace =
    rules.war.pace === 'live'
      ? `Live ${rules.war.liveClock}`
      : `Correspondence · ${rules.war.hoursPerMove === 24 ? '1 day' : `${rules.war.hoursPerMove} hours`} per move`;
  const cap = Math.max(rules.war.tokenCap, model.tokens);
  return (
    <section className="space-y-3">
      <div>
        <div className="label">Round {campaign.round}</div>
        <p className="text-sm text-muted">{pace}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="label">War tokens</span>
        <span className="flex gap-1" aria-label={`${model.tokens} war ${model.tokens === 1 ? 'token' : 'tokens'}`}>
          {Array.from({ length: cap }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`size-3.5 rounded-full border ${i < model.tokens ? 'border-grease bg-grease' : 'border-line-strong'}`}
            />
          ))}
        </span>
        <span className="text-sm text-muted tabular-nums">{model.tokens}</span>
      </div>
      {isHost && (
        <div className="space-y-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={next.isPending}
            onClick={() => {
              const question = `Start round ${campaign.round + 1}? Everyone gains ${rules.war.tokensPerRound} war ${
                rules.war.tokensPerRound === 1 ? 'token' : 'tokens'
              }, up to ${rules.war.tokenCap}.`;
              if (confirm(question)) next.mutate();
            }}
          >
            Next round
          </button>
          {next.error && <Notice tone="error">{errorMessage(next.error)}</Notice>}
        </div>
      )}
      <NotificationsToggle />
    </section>
  );
}

function WarList({
  model,
  wars,
  onOpenWar,
  highlight = false,
}: {
  model: CampaignModel;
  wars: WarView[];
  onOpenWar(warId: string): void;
  highlight?: boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {wars.map((war) => {
        const attacker = model.membersById.get(war.attackerId);
        const target = model.idx.byId.get(war.targetId);
        return (
          <li key={war.id}>
            <button
              type="button"
              onClick={() => onOpenWar(war.id)}
              className={`flex min-h-12 w-full items-center gap-2 rounded-[3px] border px-3 py-2 text-left hover:bg-raised ${
                highlight ? 'border-amber/70 bg-amber/5' : 'border-line'
              }`}
            >
              {attacker && <EmpireSwatch color={attacker.color} size={14} className="shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.95rem] font-semibold">
                  {playerName(model, war.attackerId)} <span className="text-grease">⟶</span> {target?.name}{' '}
                  <span className="font-normal text-muted tabular-nums">({target?.value})</span>
                </span>
                <span className="block truncate text-sm text-muted">{warStatusText(model, war)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** My games underway, with the ones waiting for my move first. */
function YourGames({ model, onOpenGame }: { model: CampaignModel; onOpenGame(gameId: string): void }) {
  const me = model.me.userId;
  const mine = useMyGames(model);
  const now = useNow(1000, mine.length > 0);
  if (mine.length === 0) return null;
  const rows = mine
    .map(({ war, gameId, game, myMove }) => {
      const left = game?.deadline
        ? Date.parse(game.deadline) - Date.parse(game.serverNow) - (now - game.receivedAt)
        : null;
      return { war, gameId, myMove, left };
    })
    .sort((a, b) => Number(b.myMove) - Number(a.myMove));
  return (
    <section>
      <h2 className="label mb-2">Your games</h2>
      <ul className="space-y-1.5">
        {rows.map(({ war, gameId, myMove, left }) => (
          <li key={gameId}>
            <button
              type="button"
              onClick={() => onOpenGame(gameId)}
              className={`flex min-h-12 w-full items-center gap-2 rounded-[3px] border px-3 py-2 text-left hover:bg-raised ${
                myMove ? 'border-amber/70 bg-amber/5' : 'border-line'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.95rem] font-semibold">
                  Battle for {countryName(model, war.targetId)}
                </span>
                <span className="block truncate text-sm text-muted">
                  vs {playerName(model, war.attackerId === me ? war.defenderId : war.attackerId)}
                </span>
              </span>
              <span className={`text-sm font-bold ${myMove ? 'text-amber' : 'text-muted'}`}>
                {myMove ? 'Your move' : 'Their move'}
                {left !== null && model.campaign.rules.war.pace === 'correspondence' && (
                  <span className="block text-right font-normal tabular-nums">{timeLeft(left)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
