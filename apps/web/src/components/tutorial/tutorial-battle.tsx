'use client';

import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TUTORIAL_DEFENDER,
  TUTORIAL_PLAYER,
  TUTORIAL_TACTIC,
  TUTORIAL_TARGET,
  battleWon,
  judgeMove,
  movesText,
  tacticGame,
  tacticSans,
} from '@/lib/tutorial';
import { Board } from '../game/board';
import { PlayerStrip, TypedMove } from '../game/game-panel';
import type { StepProps } from './tutorial-steps';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The battle: the war game's board, strips and typed moves, on a scripted position. The player
 * plays White; Cleo's one legal reply comes by itself. A move off the winning line is taken back
 * with a word on why, a hint can show the way, and the game can be skipped, which plays the win.
 */
export function BattleStep({ model, state, dispatch, headingRef }: StepProps) {
  const target = model.idx.byId.get(TUTORIAL_TARGET)!;
  const defender = model.membersById.get(TUTORIAL_DEFENDER)!;
  const stakeNames = (state.stake?.stake ?? []).map((id) => model.idx.byId.get(id)?.name ?? id);
  const { moves } = state;
  const game = useMemo(() => tacticGame(moves), [moves]);
  const won = battleWon(moves);
  const [wrong, setWrong] = useState<string | null>(null);
  const [hint, setHint] = useState(0);
  // Puts the board back after a move that isn't taken.
  const [resync, setResync] = useState(0);

  // Cleo's reply, after a moment, as a bot's would come.
  const replying = !won && moves.length % 2 === 1;
  useEffect(() => {
    if (!replying) return;
    const timer = setTimeout(() => dispatch({ type: 'reply' }), reducedMotion() ? 200 : 800);
    return () => clearTimeout(timer);
  }, [replying, dispatch]);
  // A new position needs a new hint.
  useEffect(() => setHint(0), [moves.length]);

  const tryMove = useCallback(
    (uci: string) => {
      const verdict = judgeMove(moves, uci);
      if (verdict === 'right') {
        setWrong(null);
        dispatch({ type: 'move', uci });
        return;
      }
      if (verdict === 'wrong') {
        const san = tacticGame(moves).play(tacticGame(moves).parseInput(uci)!);
        setWrong(
          `${san} is a legal move, but it gives ${defender.name} time to hit back: the queen is already attacking. Look for a check.`,
        );
      }
      setResync((n) => n + 1);
    },
    [moves, dispatch, defender.name],
  );

  const onBoardMove = useRef<(from: string, to: string) => void>(() => {});
  useEffect(() => {
    onBoardMove.current = (from, to) => tryMove(from + to);
  });
  const after = useCallback((from: Key, to: Key) => onBoardMove.current(from, to), []);

  const playable = !won && game.turn === 'white';
  const last = moves.at(-1);
  const config: Config = useMemo(() => {
    // The second hint draws the move: the first rook's check, or the other rook taking back.
    const arrow = moves.length === 0 ? TUTORIAL_TACTIC.hint : { from: 'd1', to: 'd8' };
    const shapes: DrawShape[] =
      hint >= 2 && playable ? [{ orig: arrow.from as Key, dest: arrow.to as Key, brush: 'yellow' }] : [];
    return {
      fen: game.fen,
      orientation: 'white',
      turnColor: game.turn,
      lastMove: last ? ([last.slice(0, 2), last.slice(2, 4)] as Key[]) : undefined,
      check: game.isCheck(),
      coordinates: true,
      viewOnly: won,
      animation: { enabled: !reducedMotion(), duration: 220 },
      movable: {
        free: false,
        color: playable ? 'white' : undefined,
        dests: (playable ? game.dests() : new Map()) as Map<Key, Key[]>,
        showDests: true,
        events: { after },
      },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      drawable: { enabled: false, visible: true, autoShapes: shapes },
      blockTouchScroll: true,
    };
    // `resync` puts the board back after a move that isn't taken.
  }, [game, moves.length, last, won, playable, after, resync, hint]);

  const sans = game.sans;
  const status = won
    ? state.skipped
      ? `Played for you: ${movesText(sans)}. Checkmate: you win the battle for ${target.name}.`
      : `Checkmate: ${defender.name}’s king has nowhere to go. You win the battle for ${target.name}.`
    : replying
      ? `Check. ${defender.name} has one legal reply…`
      : moves.length === 2
        ? `${movesText(sans)}: forced, ${defender.name} had to take. Now finish it.`
        : null;
  const hintText =
    moves.length === 0
      ? [
          `${defender.name}’s king is walled in by its own pawns, and only the rook on c8 guards the back rank.`,
          'Rook from d2 to d8, with check: Rd8+.',
        ]
      : ['Two rooks against one on the d-file.', 'Take back on d8 with the other rook: Rxd8 is mate.'];

  return (
    // On wide screens the board has a column of its own, as big as the room's height allows, and
    // everything else goes beside it, so the board stays in view.
    <div className="flex min-h-full flex-col gap-3 p-3 lg:grid lg:grid-cols-[auto_minmax(15rem,22rem)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-5 lg:p-4">
      <header className="lg:col-start-2 lg:row-start-1">
        <p className="label text-amber">Step 4 of 5 · Sample war game</p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-1 font-stencil text-[1.7rem] leading-tight tracking-wide outline-none"
        >
          Battle for {target.name}
        </h2>
        <p className="mt-1 leading-snug text-pretty">
          {won ? (
            <>The war is decided.</>
          ) : (
            <>
              {defender.name} accepted, so one game of chess decides the war. You play White, the attacker. Later in the
              game, at move {TUTORIAL_TACTIC.fen.split(' ')[5]}, {defender.name}’s queen has broken in and attacks your
              rook on d2. <strong>Find mate in two.</strong>
            </>
          )}
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-13rem))] min-w-[16rem] flex-col gap-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:w-[min(calc(100dvh-15.5rem),calc(100vw-38rem))] lg:max-w-none">
        <PlayerStrip
          model={model}
          userId={TUTORIAL_DEFENDER}
          color="black"
          clockMs={null}
          toMove={!won && game.turn === 'black'}
          perMoveLeft={null}
          note={null}
        />
        <div
          className="relative aspect-square w-full"
          role="group"
          aria-label={won ? 'Chess board: the final position' : `Chess board: ${game.turn} to move`}
        >
          <Board config={config} />
        </div>
        <PlayerStrip
          model={model}
          userId={TUTORIAL_PLAYER}
          color="white"
          clockMs={null}
          toMove={playable}
          perMoveLeft={null}
          note={null}
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:self-stretch">
        <div aria-live="polite" className="space-y-2">
          {wrong && !won && (
            <p className="rounded-[3px] border border-grease/60 bg-grease/10 px-3 py-2 text-[0.95rem]">
              <strong>Taken back.</strong> {wrong}
            </p>
          )}
          {status && (
            <p
              className={`rounded-[3px] border px-3 py-2 ${
                won ? 'border-amber bg-amber/15 font-semibold' : 'border-line-strong bg-raised text-[0.95rem]'
              }`}
            >
              {status}
            </p>
          )}
          {!won && hint > 0 && <p className="text-[0.95rem] text-amber">Hint: {hintText.slice(0, hint).join(' ')}</p>}
        </div>

        {won ? (
          <div className="sticky bottom-0 -mx-3 mt-auto flex border-t border-line bg-panel px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:mx-0 lg:mt-0 lg:border-t-0 lg:p-0">
            <button
              type="button"
              className="btn btn-primary flex-1 sm:flex-none"
              onClick={() => dispatch({ type: 'next' })}
            >
              See what changed
            </button>
          </div>
        ) : (
          <>
            {playable && (
              <div className="space-y-2">
                <TypedMove chess={game} pending={false} onMove={tryMove} />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={hint >= hintText.length}
                  onClick={() => setHint((h) => h + 1)}
                >
                  {hint === 0 ? 'Hint' : 'Another hint'}
                </button>
              </div>
            )}
            <p className="text-[0.95rem] leading-relaxed text-pretty text-muted">
              Win, and {target.name} is yours; lose, and {defender.name} takes {stakeNames.join(' and ')}.
            </p>
            <section aria-labelledby="tutorial-skip" className="rounded-[3px] border border-line p-3">
              <h3 id="tutorial-skip" className="font-bold">
                Not a chess player?
              </h3>
              <p className="mt-1 text-[0.95rem] leading-snug text-pretty">
                Skipping plays the winning line for you, {movesText(tacticSans())}, and the war ends exactly as if you’d
                played it: {target.name} becomes yours. In a real campaign, you play your battles yourself.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => {
                  setWrong(null);
                  dispatch({ type: 'skip' });
                }}
              >
                Skip the battle
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
