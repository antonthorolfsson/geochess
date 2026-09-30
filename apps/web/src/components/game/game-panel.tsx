'use client';

import { ChessGame, opposite, valueOf, type Color, type GameView, type WarView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys, newerGame, toBoardGame, useGame, type BoardGame } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import { countryName, formatClock, outcomeText, playerName, resultText, timeControlText, timeLeft } from '@/lib/wars';
import { PlayerName } from '../campaign/player-name';
import { Notice, Spinner } from '../ui';
import { Board } from './board';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A war game: the board, both clocks, the moves, and the player's controls. */
export function GamePanel({
  model,
  gameId,
  onClose,
  onOpenWar,
}: {
  model: CampaignModel;
  gameId: string;
  onClose(): void;
  onOpenWar(warId: string): void;
}) {
  const query = useGame(gameId);
  return (
    <section aria-label="Game" className="flex min-h-full flex-col">
      {query.data ? (
        <GameBoard model={model} game={query.data} onClose={onClose} onOpenWar={onOpenWar} />
      ) : (
        <div className="space-y-4 p-4">
          <CloseButton onClose={onClose} />
          {query.error ? (
            <Notice tone="error">{errorMessage(query.error)}</Notice>
          ) : (
            <Spinner label="Setting up the board" />
          )}
        </div>
      )}
    </section>
  );
}

function CloseButton({ onClose }: { onClose(): void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close the board"
      className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center text-2xl text-muted hover:text-paper"
    >
      ×
    </button>
  );
}

function GameBoard({
  model,
  game,
  onClose,
  onOpenWar,
}: {
  model: CampaignModel;
  game: BoardGame;
  onClose(): void;
  onOpenWar(warId: string): void;
}) {
  const queryClient = useQueryClient();
  const me = model.me.userId;
  const war = model.campaign.wars.find((w) => w.id === game.warId);
  const myColor: Color | null = game.whiteId === me ? 'white' : game.blackId === me ? 'black' : null;
  const [flipped, setFlipped] = useState(false);
  const bottom: Color = flipped ? opposite(myColor ?? 'white') : (myColor ?? 'white');
  const chess = useMemo(() => ChessGame.fromMoves(game.moves), [game.moves]);
  const playing = game.status === 'playing';
  const live = game.timeControl.kind === 'live';
  const now = useNow(live ? 100 : 1000, playing);
  // The server's clock differs from ours; count from when each state arrived.
  const localStart = game.startsAt ? game.receivedAt + Date.parse(game.startsAt) - Date.parse(game.serverNow) : 0;
  const countdown = playing ? localStart - now : 0;
  const started = countdown <= 0;
  const turn = chess.turn;
  const canMove = playing && started && myColor !== null;
  const myTurn = canMove && turn === myColor;

  const [error, setError] = useState<string | null>(null);
  const [resync, setResync] = useState(0);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const apply = (view: GameView) =>
    queryClient.setQueryData<BoardGame>(keys.game(game.id), (current) => newerGame(current, toBoardGame(view)));
  const move = useMutation({
    mutationFn: (uci: string) => api.move(game.id, uci, game.moves.length),
    onMutate: () => setError(null),
    onSuccess: apply,
    onError: (err) => {
      setError(errorMessage(err));
      setResync((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: keys.game(game.id) });
    },
  });
  const action = useMutation({
    mutationFn: (run: () => Promise<GameView>) => run(),
    onMutate: () => setError(null),
    onSuccess: apply,
    onError: (err) => setError(errorMessage(err)),
  });

  // The board calls back into the latest render, so the config can stay the same between ticks.
  const onBoardMove = useRef<(from: string, to: string) => void>(() => {});
  useEffect(() => {
    onBoardMove.current = (from, to) => {
      if (chess.isPromotion(from, to)) setPromotion({ from, to });
      else move.mutate(from + to);
    };
  });
  const after = useCallback((from: Key, to: Key) => onBoardMove.current(from, to), []);

  const last = game.moves.at(-1);
  const config: Config = useMemo(
    () => ({
      fen: chess.fen,
      orientation: bottom,
      turnColor: chess.turn,
      lastMove: last ? ([last.slice(0, 2), last.slice(2, 4)] as Key[]) : undefined,
      check: chess.isCheck(),
      coordinates: true,
      viewOnly: myColor === null || game.status === 'finished' || game.status === 'cancelled',
      animation: { enabled: !reducedMotion(), duration: 180 },
      movable: {
        free: false,
        color: canMove ? (myColor ?? undefined) : undefined,
        dests: (canMove && chess.turn === myColor ? chess.dests() : new Map()) as Map<Key, Key[]>,
        showDests: true,
        events: { after },
      },
      premovable: { enabled: canMove && live },
      draggable: { showGhost: true },
      blockTouchScroll: true,
    }),
    // `resync` puts the board back after a refused move.
    [chess, bottom, last, myColor, game.status, canMove, live, after, resync],
  );

  const clock = (color: Color) => {
    if (!game.clocks) return null;
    const running = playing && started && color === turn;
    return game.clocks[color] - (running ? Math.max(0, now - Math.max(game.receivedAt, localStart)) : 0);
  };
  const perMoveLeft = game.deadline
    ? Date.parse(game.deadline) - Date.parse(game.serverNow) - (now - game.receivedAt)
    : null;
  const opponentOffered = game.drawOfferBy !== null && game.drawOfferBy !== me;
  const target = war ? model.idx.byId.get(war.targetId) : undefined;

  const strip = (color: Color) => (
    <PlayerStrip
      model={model}
      userId={color === 'white' ? game.whiteId : game.blackId}
      color={color}
      clockMs={clock(color)}
      toMove={playing && color === turn}
      perMoveLeft={!live && playing && color === turn ? perMoveLeft : null}
      offeredDraw={game.drawOfferBy === (color === 'white' ? game.whiteId : game.blackId)}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-3 p-3 lg:p-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="label">{game.armageddon ? 'Armageddon · Black wins a draw' : 'War game'}</div>
          <h2 className="truncate font-stencil text-2xl leading-tight tracking-wide">
            Battle for {target?.name ?? 'the frontier'}
          </h2>
        </div>
        <CloseButton onClose={onClose} />
      </header>

      {strip(opposite(bottom))}
      <div className="relative aspect-square w-full">
        <Board config={config} playPremove={myTurn} />
        {promotion && (
          <PromotionPicker
            color={myColor ?? 'white'}
            onPick={(role) => {
              setPromotion(null);
              move.mutate(promotion.from + promotion.to + role);
            }}
            onCancel={() => {
              setPromotion(null);
              setResync((n) => n + 1);
            }}
          />
        )}
        {playing && !started && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gunmetal/55">
            <div className="rounded-[3px] bg-amber px-4 py-2 text-center font-stencil text-2xl tracking-wide text-gunmetal">
              Clocks start in {Math.ceil(countdown / 1000)}
            </div>
          </div>
        )}
      </div>
      {strip(bottom)}

      {game.status === 'finished' && game.result && (
        <div className="rounded-[3px] border border-line-strong bg-raised px-3 py-2">
          <div className="font-stencil text-xl tracking-wide">{resultText(game.result, game.reason)}</div>
          {war?.status === 'resolved' && <p className="text-[0.95rem]">{outcomeText(model, war)}.</p>}
          {war && war.status !== 'resolved' && war.games.at(-1)?.id !== game.id && (
            <p className="text-[0.95rem]">A draw: the war goes to an Armageddon tiebreak.</p>
          )}
        </div>
      )}
      {game.status === 'waiting' && (
        <Notice>
          {model.turns?.current
            ? 'This game starts once everyone has finished declaring, and both players have finished their other games.'
            : 'This game starts when both players have finished their other games.'}
        </Notice>
      )}
      {game.status === 'cancelled' && (
        <Notice>The campaign ended before this game did. The moves stand; there is no result.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {myColor && (playing || game.status === 'waiting') && (
        <div className="flex flex-wrap gap-2">
          {opponentOffered ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={action.isPending}
                onClick={() => action.mutate(() => api.draw(game.id, 'accept'))}
              >
                Accept draw
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={action.isPending}
                onClick={() => action.mutate(() => api.draw(game.id, 'decline'))}
              >
                Decline draw
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.isPending || game.drawOfferBy === me}
              onClick={() => action.mutate(() => api.draw(game.id, 'offer'))}
            >
              {game.drawOfferBy === me ? 'Draw offered' : 'Offer draw'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={action.isPending}
            onClick={() => {
              if (confirm('Resign this game?')) action.mutate(() => api.resign(game.id));
            }}
          >
            Resign
          </button>
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setFlipped((f) => !f)}>
            Flip board
          </button>
        </div>
      )}
      {!myColor && (
        <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setFlipped((f) => !f)}>
          Flip board
        </button>
      )}

      {myTurn && <TypedMove chess={chess} pending={move.isPending} onMove={(uci) => move.mutate(uci)} />}

      <MoveList sans={chess.sans} />

      {war && <WarContext model={model} war={war} game={game} onOpenWar={onOpenWar} />}
    </div>
  );
}

function PlayerStrip({
  model,
  userId,
  color,
  clockMs,
  toMove,
  perMoveLeft,
  offeredDraw,
}: {
  model: CampaignModel;
  userId: string;
  color: Color;
  clockMs: number | null;
  toMove: boolean;
  perMoveLeft: number | null;
  offeredDraw: boolean;
}) {
  const low = clockMs !== null && clockMs < 20_000;
  return (
    <div className="flex min-h-12 items-center gap-3">
      <span
        aria-hidden="true"
        className={`size-3.5 shrink-0 rounded-full border border-line-strong ${color === 'white' ? 'bg-paper' : 'bg-gunmetal'}`}
      />
      <span className="min-w-0 flex-1">
        <PlayerName member={model.membersById.get(userId)} you={userId === model.me.userId} size="sm" />
        {offeredDraw && <span className="ml-2 text-xs font-bold text-amber uppercase">offers a draw</span>}
      </span>
      {clockMs !== null ? (
        <span
          role="timer"
          aria-label={`${color} clock`}
          className={`min-w-[5.5rem] rounded-[3px] px-2 py-1 text-right font-mono text-2xl font-bold tabular-nums ${
            toMove ? (low ? 'bg-grease text-paper' : 'bg-paper text-gunmetal') : 'bg-raised text-muted'
          }`}
        >
          {formatClock(clockMs)}
        </span>
      ) : (
        toMove && (
          <span className="text-sm font-bold text-amber">
            To move{perMoveLeft !== null ? ` · ${timeLeft(perMoveLeft)} left` : ''}
          </span>
        )
      )}
    </div>
  );
}

const PROMOTIONS = [
  { role: 'q', name: 'Queen', glyph: { white: '♕', black: '♛' } },
  { role: 'r', name: 'Rook', glyph: { white: '♖', black: '♜' } },
  { role: 'b', name: 'Bishop', glyph: { white: '♗', black: '♝' } },
  { role: 'n', name: 'Knight', glyph: { white: '♘', black: '♞' } },
] as const;

function PromotionPicker({ color, onPick, onCancel }: { color: Color; onPick(role: string): void; onCancel(): void }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-gunmetal/70"
      role="dialog"
      aria-label="Promote to"
    >
      <div className="panel space-y-2 p-3">
        <div className="label text-center">Promote to</div>
        <div className="flex gap-2">
          {PROMOTIONS.map((p) => (
            <button
              key={p.role}
              type="button"
              aria-label={p.name}
              onClick={() => onPick(p.role)}
              className="flex size-14 items-center justify-center rounded-[3px] bg-paper text-4xl text-gunmetal hover:bg-amber"
            >
              {p.glyph[color]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm w-full" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Keyboard move entry: SAN (Nf3, O-O) or UCI (g1f3). */
function TypedMove({ chess, pending, onMove }: { chess: ChessGame; pending: boolean; onMove(uci: string): void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const uci = chess.parseInput(text);
        if (!uci) {
          setProblem(`${text.trim() || 'That'} is not a legal move here.`);
          return;
        }
        setProblem(null);
        setText('');
        onMove(uci);
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">Type a move</span>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a move: e4, Nf3, O-O"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={problem !== null}
          aria-describedby={problem ? 'typed-move-problem' : undefined}
        />
        {problem && (
          <span id="typed-move-problem" className="mt-1 block text-sm text-[#f19a92]">
            {problem}
          </span>
        )}
      </label>
      <button type="submit" className="btn btn-ghost" disabled={pending || !text.trim()}>
        Move
      </button>
    </form>
  );
}

function MoveList({ sans }: { sans: string[] }) {
  const end = useRef<HTMLOListElement>(null);
  useEffect(() => {
    end.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [sans.length]);
  if (sans.length === 0) return <p className="text-sm text-muted">No moves yet.</p>;
  const rows = [];
  for (let i = 0; i < sans.length; i += 2) rows.push({ n: i / 2 + 1, white: sans[i]!, black: sans[i + 1] });
  return (
    <ol
      ref={end}
      className="grid max-h-40 grid-cols-[2.5rem_1fr_1fr] gap-x-2 overflow-y-auto font-mono text-[0.95rem]"
      aria-label="Moves"
    >
      {rows.map((r) => (
        <li key={r.n} className="contents">
          <span className="text-faint tabular-nums">{r.n}.</span>
          <span>{r.white}</span>
          <span>{r.black ?? ''}</span>
        </li>
      ))}
    </ol>
  );
}

function WarContext({
  model,
  war,
  game,
  onOpenWar,
}: {
  model: CampaignModel;
  war: WarView;
  game: BoardGame;
  onOpenWar(warId: string): void;
}) {
  return (
    <div className="space-y-1 border-t border-line pt-3 text-sm text-muted">
      <p>
        <strong className="text-paper">{playerName(model, war.attackerId)}</strong> attacks{' '}
        {countryName(model, war.targetId)} ({model.idx.byId.get(war.targetId)?.value}), staking{' '}
        {war.stake.map((id) => countryName(model, id)).join(', ')} ({valueOf(model.idx, war.stake)}).
      </p>
      <p>
        White {timeControlText(game.timeControl, 'white')}, Black {timeControlText(game.timeControl, 'black')}.
      </p>
      <button type="button" className="underline underline-offset-2 hover:text-paper" onClick={() => onOpenWar(war.id)}>
        War details
      </button>
    </div>
  );
}
