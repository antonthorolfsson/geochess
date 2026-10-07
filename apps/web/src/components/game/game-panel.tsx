'use client';

import {
  ChessGame,
  opposite,
  valueOf,
  type Color,
  type GameView,
  type OverTheBoardAction,
  type WarView,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys, newerGame, toBoardGame, useGame, type BoardGame } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import { countryName, formatClock, outcomeText, playerName, resultText, timeControlText, timeLeft } from '@/lib/wars';
import { PlayerName } from '../campaign/player-name';
import { WarOutcomes, WarStakesNote } from '../campaign/war-outcomes';
import { FullscreenIcon, Notice, Spinner } from '../ui';
import { Board } from './board';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A war game: the board, both clocks, the moves, and the player's controls. `ref` is the panel, which
 * can take focus: the campaign screen moves focus here when the panel it was in folds away.
 */
export function GamePanel({
  ref,
  model,
  gameId,
  onClose,
  onOpenWar,
  fullscreen,
  onFullscreen,
}: {
  ref?: Ref<HTMLElement>;
  model: CampaignModel;
  gameId: string;
  onClose(): void;
  onOpenWar(warId: string): void;
  /** The board fills the screen, with the moves and controls beside it where there's room. */
  fullscreen: boolean;
  onFullscreen(): void;
}) {
  const query = useGame(gameId);
  const panelRef = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => panelRef.current!, []);
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label="Game"
      className={`flex flex-col outline-none ${fullscreen ? 'h-full' : 'min-h-full'}`}
    >
      {query.data ? (
        <GameBoard
          key={query.data.id}
          panelRef={panelRef}
          model={model}
          game={query.data}
          onClose={onClose}
          onOpenWar={onOpenWar}
          fullscreen={fullscreen}
          onFullscreen={onFullscreen}
        />
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

function FullscreenButton({ on, onClick }: { on: boolean; onClick(): void }) {
  const label = on ? 'Exit full screen' : 'Full screen';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className="-mt-1 flex size-11 shrink-0 items-center justify-center text-muted hover:text-paper"
    >
      <FullscreenIcon on={on} />
    </button>
  );
}

function GameBoard({
  panelRef,
  model,
  game,
  onClose,
  onOpenWar,
  fullscreen,
  onFullscreen,
}: {
  /** The whole panel: arrow keys step through the moves from anywhere in it. */
  panelRef: RefObject<HTMLElement | null>;
  model: CampaignModel;
  game: BoardGame;
  onClose(): void;
  onOpenWar(warId: string): void;
  fullscreen: boolean;
  onFullscreen(): void;
}) {
  const queryClient = useQueryClient();
  const me = model.me.userId;
  const war = model.campaign.wars.find((w) => w.id === game.warId);
  const myColor: Color | null = game.whiteId === me ? 'white' : game.blackId === me ? 'black' : null;
  const [flipped, setFlipped] = useState(false);
  const bottom: Color = flipped ? opposite(myColor ?? 'white') : (myColor ?? 'white');
  const chess = useMemo(() => ChessGame.fromMoves(game.moves), [game.moves]);
  const playing = game.status === 'playing';
  const otb = playing && game.overTheBoard;
  const live = game.timeControl.kind === 'live';
  const now = useNow(live && !otb ? 100 : 1000, playing);
  // The server's clock differs from ours; count from when each state arrived.
  const localStart = game.startsAt ? game.receivedAt + Date.parse(game.startsAt) - Date.parse(game.serverNow) : 0;
  const countdown = playing && !otb ? localStart - now : 0;
  const started = countdown <= 0;
  const turn = chess.turn;
  const canMove = playing && !otb && started && myColor !== null;
  const myTurn = canMove && turn === myColor;

  // Stepping through the moves: null follows the game; a number holds the position after that many.
  const [viewPly, setViewPly] = useState<number | null>(null);
  const plies = game.moves.length;
  const shownPly = Math.min(viewPly ?? plies, plies);
  const browsing = shownPly < plies;
  const shown = useMemo(
    () => (browsing ? ChessGame.fromMoves(game.moves.slice(0, shownPly)) : chess),
    [browsing, chess, game.moves, shownPly],
  );
  const goTo = useCallback((ply: number) => setViewPly(ply >= plies ? null : Math.max(0, ply)), [plies]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      // Only from the board's own panel, or with nothing in particular focused: the map pans with arrows.
      if (target && target !== document.body && !panelRef.current?.contains(target)) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const to =
        e.key === 'ArrowLeft'
          ? shownPly - 1
          : e.key === 'ArrowRight'
            ? shownPly + 1
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? plies
                : null;
      if (to === null) return;
      e.preventDefault();
      goTo(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shownPly, plies, goTo, panelRef]);

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

  const last = game.moves[shownPly - 1];
  // A past position is only to look at.
  const playable = canMove && !browsing;
  const config: Config = useMemo(
    () => ({
      fen: shown.fen,
      orientation: bottom,
      turnColor: shown.turn,
      lastMove: last ? ([last.slice(0, 2), last.slice(2, 4)] as Key[]) : undefined,
      check: shown.isCheck(),
      coordinates: true,
      viewOnly: myColor === null || game.status === 'finished' || game.status === 'cancelled' || browsing,
      animation: { enabled: !reducedMotion(), duration: 180 },
      movable: {
        free: false,
        color: playable ? (myColor ?? undefined) : undefined,
        dests: (playable && shown.turn === myColor ? shown.dests() : new Map()) as Map<Key, Key[]>,
        showDests: true,
        events: { after },
      },
      premovable: { enabled: playable && live },
      draggable: { showGhost: true },
      blockTouchScroll: true,
    }),
    // `resync` puts the board back after a refused move.
    [shown, bottom, last, myColor, game.status, browsing, playable, live, after, resync],
  );

  const clock = (color: Color) => {
    if (!game.clocks) return null;
    const running = playing && !otb && started && color === turn;
    return game.clocks[color] - (running ? Math.max(0, now - Math.max(game.receivedAt, localStart)) : 0);
  };
  const perMoveLeft = game.deadline
    ? Date.parse(game.deadline) - Date.parse(game.serverNow) - (now - game.receivedAt)
    : null;
  const opponentOffered = game.drawOfferBy !== null && game.drawOfferBy !== me;
  const target = war ? model.idx.byId.get(war.targetId) : undefined;
  const opponentId = myColor === 'white' ? game.blackId : game.whiteId;
  // Bots, standing in for a person too, play online only.
  const people = !model.membersById.get(game.whiteId)?.bot && !model.membersById.get(game.blackId)?.bot;

  const strip = (color: Color) => {
    const userId = color === 'white' ? game.whiteId : game.blackId;
    const note =
      otb && game.report?.by === userId
        ? game.report.result === '1/2-1/2'
          ? 'reports a draw'
          : 'reports a win'
        : !otb && game.overTheBoardOfferBy === userId
          ? 'offers a real board'
          : game.drawOfferBy === userId
            ? 'offers a draw'
            : null;
    return (
      <PlayerStrip
        model={model}
        userId={userId}
        color={color}
        clockMs={clock(color)}
        toMove={playing && !otb && color === turn}
        perMoveLeft={!live && playing && !otb && color === turn ? perMoveLeft : null}
        note={note}
      />
    );
  };

  return (
    <div className={`flex flex-1 flex-col gap-3 p-3 lg:p-4 ${fullscreen ? 'min-h-0' : ''}`}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="label">{game.armageddon ? 'Armageddon · Black wins a draw' : 'War game'}</div>
          <h2 className="truncate font-stencil text-2xl leading-tight tracking-wide">
            Battle for {target?.name ?? 'the frontier'}
          </h2>
          {war && war.status !== 'resolved' && <WarStakesNote model={model} war={war} className="block text-sm" />}
        </div>
        <FullscreenButton on={fullscreen} onClick={onFullscreen} />
        <CloseButton onClose={onClose} />
      </header>

      {/* Full screen, the board takes the height it can and the rest goes beside it on wide screens. */}
      <div
        className={
          fullscreen ? 'flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start lg:justify-center' : 'contents'
        }
      >
        <div
          className={
            fullscreen
              ? 'mx-auto flex w-full max-w-[calc(100dvh-13rem)] flex-col gap-3 lg:mx-0 lg:min-w-0 lg:flex-1'
              : 'contents'
          }
        >
          {strip(opposite(bottom))}
          <div className="relative aspect-square w-full">
            <Board config={config} playPremove={myTurn && !browsing} />
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
            {otb && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                <div className="rounded-[3px] bg-gunmetal/85 px-4 py-2 text-center font-stencil text-2xl tracking-wide text-paper">
                  Over the board
                </div>
              </div>
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
        </div>

        <div
          className={
            fullscreen ? 'flex w-full flex-col gap-3 lg:max-h-full lg:w-96 lg:shrink-0 lg:overflow-y-auto' : 'contents'
          }
        >
          <MoveNavigation ply={shownPly} plies={plies} san={chess.sans[shownPly - 1]} live={playing} onGo={goTo} />

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

          {myColor && otb && (
            <OverTheBoardControls
              model={model}
              game={game}
              me={me}
              opponentId={opponentId}
              now={now}
              pending={action.isPending}
              run={(act) => action.mutate(() => api.overTheBoard(game.id, act))}
              onResign={() => {
                if (confirm('Report that you lost? This ends the game at once.'))
                  action.mutate(() => api.resign(game.id));
              }}
              onFlip={() => setFlipped((f) => !f)}
            />
          )}
          {myColor && !otb && playing && people && (
            <OverTheBoardOffer
              model={model}
              game={game}
              me={me}
              pending={action.isPending}
              run={(act) => action.mutate(() => api.overTheBoard(game.id, act))}
            />
          )}
          {!myColor && otb && (
            <Notice>
              {playerName(model, game.whiteId)} and {playerName(model, game.blackId)} are playing this game over the
              board, on a real board. The result appears here once they report it.
            </Notice>
          )}

          {myColor && !otb && (playing || game.status === 'waiting') && (
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

          {myTurn && !browsing && (
            <TypedMove chess={chess} pending={move.isPending} onMove={(uci) => move.mutate(uci)} />
          )}

          <MoveList sans={chess.sans} ply={shownPly} onGo={goTo} tall={fullscreen} />

          {war && <WarContext model={model} war={war} game={game} onOpenWar={onOpenWar} />}
        </div>
      </div>
    </div>
  );
}

export function PlayerStrip({
  model,
  userId,
  color,
  clockMs,
  toMove,
  perMoveLeft,
  note,
}: {
  model: CampaignModel;
  userId: string;
  color: Color;
  clockMs: number | null;
  toMove: boolean;
  perMoveLeft: number | null;
  /** What the player offers or reports, if anything: "offers a draw". */
  note: string | null;
}) {
  const low = clockMs !== null && clockMs < 20_000;
  const member = model.membersById.get(userId);
  return (
    <div className="flex min-h-12 items-center gap-3">
      <span
        aria-hidden="true"
        className={`size-3.5 shrink-0 rounded-full border border-line-strong ${color === 'white' ? 'bg-paper' : 'bg-gunmetal'}`}
      />
      <span className="min-w-0 flex-1">
        <PlayerName member={member} you={userId === model.me.userId} size="sm" />
        {note && <span className="ml-2 text-xs font-bold text-amber uppercase">{note}</span>}
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
        toMove &&
        (member?.bot ? (
          // Bots reply within seconds, whatever the time per move.
          <span className="text-sm font-bold text-amber">Thinking…</span>
        ) : (
          <span className="text-sm font-bold text-amber">
            To move{perMoveLeft !== null ? ` · ${timeLeft(perMoveLeft)} left` : ''}
          </span>
        ))
      )}
    </div>
  );
}

/** Online: offering to play the game over the board, or answering the other player's offer. */
function OverTheBoardOffer({
  model,
  game,
  me,
  pending,
  run,
}: {
  model: CampaignModel;
  game: BoardGame;
  me: string;
  pending: boolean;
  run(action: OverTheBoardAction): void;
}) {
  const offerBy = game.overTheBoardOfferBy;
  if (offerBy && offerBy !== me) {
    return (
      <div className="space-y-2 rounded-[3px] border border-amber/70 bg-amber/5 px-3 py-2">
        <p className="text-[0.95rem]">
          {playerName(model, offerBy)} wants to play this game over the board, on a real board. The clocks here stop,
          and you report the result when the game is over.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run('accept')}>
            Play over the board
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run('decline')}>
            Keep playing online
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending || offerBy === me}
        onClick={() => run('offer')}
        title="Meeting up? Play this game on a real board and report the result here."
      >
        {offerBy === me ? 'Real board offered' : 'Play over the board'}
      </button>
      {offerBy === me && (
        <span className="text-sm text-muted">
          The clocks keep running until {playerName(model, game.whiteId === me ? game.blackId : game.whiteId)} accepts.
        </span>
      )}
    </div>
  );
}

/** Over the board: reporting the result, answering the other player's report, or going back online. */
function OverTheBoardControls({
  model,
  game,
  me,
  opponentId,
  now,
  pending,
  run,
  onResign,
  onFlip,
}: {
  model: CampaignModel;
  game: BoardGame;
  me: string;
  opponentId: string;
  now: number;
  pending: boolean;
  run(action: OverTheBoardAction): void;
  onResign(): void;
  onFlip(): void;
}) {
  const { report } = game;
  const opponent = playerName(model, opponentId);
  const left = game.deadline ? Date.parse(game.deadline) - Date.parse(game.serverNow) - (now - game.receivedAt) : null;
  const stands = left !== null ? ` Unanswered, it stands in ${timeLeft(left)}.` : '';
  // A reported win is always the reporter's.
  const what = (r: NonNullable<typeof report>) => (r.result === '1/2-1/2' ? 'a draw' : 'a win');

  if (report && report.by !== me) {
    return (
      <div className="space-y-2 rounded-[3px] border border-amber/70 bg-amber/5 px-3 py-2">
        <p className="text-[0.95rem]">
          <strong>{opponent}</strong> reports {what(report)} over the board.{stands}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run('confirm')}>
            Confirm
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run('dispute')}>
            Dispute
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[0.95rem] text-muted">
        {report
          ? `You reported ${what(report)}. Waiting for ${opponent} to confirm it.${stands}`
          : `You're playing this game on a real board, so the clocks here are stopped. When it's over, report the result: ${opponent} confirms it.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || (report?.by === me && report.result !== '1/2-1/2')}
          onClick={() => run('report-win')}
        >
          I won
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={pending || (report?.by === me && report.result === '1/2-1/2')}
          onClick={() => run('report-draw')}
        >
          Draw
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={onResign}>
          I lost
        </button>
        {!report && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run('online')}>
            Play online instead
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onFlip}>
          Flip board
        </button>
      </div>
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
export function TypedMove({
  chess,
  pending,
  onMove,
}: {
  chess: ChessGame;
  pending: boolean;
  onMove(uci: string): void;
}) {
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

/** Steps through the game: the start, a move back, a move on, and the latest position. */
function MoveNavigation({
  ply,
  plies,
  san,
  live,
  onGo,
}: {
  /** The position shown: after this many moves. */
  ply: number;
  plies: number;
  /** The move that led to it. */
  san: string | undefined;
  /** The game is still being played, so the latest position is the game itself. */
  live: boolean;
  onGo(ply: number): void;
}) {
  if (plies === 0) return null;
  const steps = [
    { label: 'First position', glyph: '«', to: 0, disabled: ply === 0 },
    { label: 'Previous move', glyph: '‹', to: ply - 1, disabled: ply === 0 },
    { label: 'Next move', glyph: '›', to: ply + 1, disabled: ply === plies },
    { label: live ? 'Latest position' : 'Last position', glyph: '»', to: plies, disabled: ply === plies },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex overflow-hidden rounded-[3px] border border-line"
        role="group"
        aria-label="Step through the moves"
      >
        {steps.map((s) => (
          <button
            key={s.label}
            type="button"
            aria-label={s.label}
            title={s.label}
            disabled={s.disabled}
            onClick={() => onGo(s.to)}
            className="flex h-11 w-12 items-center justify-center border-r border-line text-2xl leading-none text-paper last:border-r-0 hover:bg-raised disabled:text-faint disabled:hover:bg-transparent"
          >
            {s.glyph}
          </button>
        ))}
      </div>
      <span className="text-sm text-muted tabular-nums" aria-live="polite">
        {ply === plies
          ? live
            ? null
            : 'Final position'
          : ply === 0
            ? 'Starting position'
            : `After ${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'} ${san}`}
      </span>
      {live && ply < plies && (
        <button type="button" className="btn btn-primary btn-sm ml-auto" onClick={() => onGo(plies)}>
          Back to the game
        </button>
      )}
    </div>
  );
}

function MoveList({
  sans,
  ply,
  onGo,
  tall,
}: {
  sans: string[];
  /** The position shown, after this many moves: its move is marked. */
  ply: number;
  onGo(ply: number): void;
  tall: boolean;
}) {
  const list = useRef<HTMLOListElement>(null);
  // Keeps the marked move in view, scrolling the list alone and not the panel around it.
  useEffect(() => {
    const box = list.current;
    const move = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !move) return;
    if (move.offsetTop < box.scrollTop) box.scrollTop = move.offsetTop;
    else if (move.offsetTop + move.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = move.offsetTop + move.offsetHeight - box.clientHeight;
    }
  }, [ply, sans.length]);
  if (sans.length === 0) return <p className="text-sm text-muted">No moves yet.</p>;
  const rows = [];
  for (let i = 0; i < sans.length; i += 2) rows.push({ n: i / 2 + 1, white: i, black: i + 1 });
  const cell = (i: number) =>
    i < sans.length ? (
      <button
        type="button"
        onClick={() => onGo(i + 1)}
        aria-current={i === ply - 1 ? 'true' : undefined}
        className={`rounded-[2px] px-1 text-left hover:bg-raised ${i === ply - 1 ? 'bg-paper text-gunmetal hover:bg-paper' : ''}`}
      >
        {sans[i]}
      </button>
    ) : (
      <span />
    );
  return (
    <ol
      ref={list}
      className={`relative grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-0.5 overflow-y-auto font-mono text-[0.95rem] ${
        tall ? 'max-h-72' : 'max-h-40'
      }`}
      aria-label="Moves"
    >
      {rows.map((r) => (
        <li key={r.n} className="contents">
          <span className="text-faint tabular-nums">{r.n}.</span>
          {cell(r.white)}
          {cell(r.black)}
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
    <div className="space-y-3 border-t border-line pt-3 text-sm text-muted">
      <p>
        <strong className="text-paper">{playerName(model, war.attackerId)}</strong> attacks{' '}
        {countryName(model, war.targetId)} ({model.idx.byId.get(war.targetId)?.value}), staking{' '}
        {war.stake.map((id) => countryName(model, id)).join(', ')} ({valueOf(model.idx, war.stake)}).
      </p>
      <p>
        White {timeControlText(game.timeControl, 'white')}, Black {timeControlText(game.timeControl, 'black')}.
      </p>
      {war.status !== 'resolved' && <WarOutcomes model={model} war={war} compact heading="What this battle changes" />}
      <button type="button" className="underline underline-offset-2 hover:text-paper" onClick={() => onOpenWar(war.id)}>
        War details
      </button>
    </div>
  );
}
