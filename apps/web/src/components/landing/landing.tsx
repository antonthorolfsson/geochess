'use client';

import {
  BOT_LEVELS,
  CORRESPONDENCE_HOURS,
  DEFAULT_RULES,
  LIVE_CLOCKS,
  MAX_PLAYERS,
  MAX_VALUE,
  MIN_PLAYERS,
  REPUTATION_BROKEN,
  RESPONSE_WINDOW_TEXT,
  lastRoundOf,
  missionRules,
  stakeFloor,
  type SessionUser,
} from '@empire/rules';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { inWords, warTokens } from '@/lib/rules-text';
import { SAMPLE_BATTLE, sampleEmpire } from '@/lib/sample-campaign';
import { Emblem } from '../app-header';
import { EmpireSwatch } from '../hatch';
import { SampleCampaign } from './sample-campaign';
import { BattleArt, DraftArt, TitlesArt } from './step-art';

/**
 * The session, as far as the page knows it: undefined until it does, then the player or null.
 * Until it's known, the page shows what a visitor sees; those links still work for a player.
 */
type Session = SessionUser | null | undefined;

/** The new campaign form, by way of signing in for a visitor. */
const startHref = (user: Session) => (user ? '/new' : '/login?next=/new');

const { war } = DEFAULT_RULES;
const points = missionRules(DEFAULT_RULES.victory.version).points;
const lastRound = lastRoundOf(DEFAULT_RULES);
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const TEXT_LINK = 'font-semibold text-paper underline decoration-line-strong underline-offset-4 hover:decoration-paper';

/**
 * The home page: what the game looks like (a sample campaign on the real map and board), how it
 * plays, and the way in. Every number comes from the rules new campaigns start with.
 */
export function Landing({ user }: { user: Session }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <Hero user={user} />
      <section id="sample" aria-labelledby="sample-heading" className="scroll-mt-4">
        <h2 id="sample-heading" className="sr-only">
          Sample campaign
        </h2>
        <SampleCampaign />
      </section>
      <HowItWorks />
      <BattleExample />
      <WaysToPlay />
      <RulesInBrief />
      <ClosingCall user={user} />
    </main>
  );
}

function Hero({ user }: { user: Session }) {
  return (
    <section aria-labelledby="landing-heading" className="flex flex-col items-center py-8 text-center sm:py-10">
      <Emblem className="size-16 sm:size-20" />
      <h1 id="landing-heading" className="mt-3 font-stencil text-5xl tracking-[0.08em] sm:text-6xl">
        GEO CHESS
      </h1>
      <p className="mt-4 max-w-2xl text-xl leading-snug text-balance sm:text-2xl">
        Claim countries with your friends. Declare wars. Settle every border over the board.
      </p>
      <p className="mt-3 max-w-xl text-lg leading-relaxed text-pretty text-muted">
        {sentence(inWords(MIN_PLAYERS))} to {inWords(MAX_PLAYERS)} players share a real world map. Draft an empire, then
        grow it one war at a time, and every war is decided by a single game of chess.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href={startHref(user)} className="btn btn-amber">
          Start a campaign
        </Link>
        <Link href="#sample" className="btn btn-ghost">
          See a sample campaign
        </Link>
      </div>
      {/* Kept the same height while the session is unknown, so nothing moves when it's known. */}
      <p className="mt-4 min-h-7 text-muted">
        {user ? (
          <>
            Signed in as {user.name}.{' '}
            <Link href="/campaigns" className={TEXT_LINK}>
              Your campaigns
            </Link>
          </>
        ) : (
          user === null && (
            <>
              Already playing?{' '}
              <Link href="/login" className={TEXT_LINK}>
                Sign in
              </Link>
            </>
          )
        )}
      </p>
    </section>
  );
}

/** A section's amber kicker and stencil headline. */
function SectionHeading({ id, kicker, children }: { id: string; kicker: string; children: ReactNode }) {
  return (
    <header>
      <p className="label text-amber">{kicker}</p>
      <h2 id={id} className="mt-1 font-stencil text-3xl leading-tight tracking-wide text-balance sm:text-4xl">
        {children}
      </h2>
    </header>
  );
}

function HowItWorks() {
  const steps: { title: string; text: ReactNode; art: ReactNode }[] = [
    {
      title: 'Draft an empire',
      text: (
        <>
          Take turns claiming real countries until the whole map is taken
          {DEFAULT_RULES.draft.mode === 'contiguous' ? ', growing out from your first pick' : ''}. Every country is
          worth 1 to {MAX_VALUE}, from its economy, population and area.
        </>
      ),
      art: <DraftArt />,
    },
    {
      title: 'Risk territory in chess battles',
      text: (
        <>
          Spend a war token to attack a neighbor, staking countries of your own. One game of chess settles it: win and
          the target is yours, lose and your stake is theirs.
        </>
      ),
      art: <BattleArt />,
    },
    {
      title: 'Complete missions and compete for titles',
      text: (
        <>
          Score points for public missions, a secret mission of your own, and titles for leading on population, land,
          GDP and military might. The first to {points.toWin} points wins.
        </>
      ),
      art: <TitlesArt toWin={points.toWin} />,
    },
  ];
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-4 pt-16 sm:pt-20">
      <SectionHeading id="how-heading" kicker="How it works">
        Draft, fight, score
      </SectionHeading>
      <ol role="list" className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="panel overflow-hidden">
            <div aria-hidden="true" className="h-32 border-b border-line bg-sea">
              {step.art}
            </div>
            <div className="p-4">
              <h3 className="flex items-start gap-3 text-xl leading-snug font-bold">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-[3px] border border-amber/70 text-base text-amber tabular-nums"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </span>
              </h3>
              <p className="mt-2 leading-relaxed text-pretty">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BattleExample() {
  const attacker = sampleEmpire(SAMPLE_BATTLE.attackerId).member;
  const defender = sampleEmpire(SAMPLE_BATTLE.defenderId).member;
  const { target, stake } = SAMPLE_BATTLE;
  const [launch] = stake;
  const floor = stakeFloor(DEFAULT_RULES, target.value);
  const exact = (target.value * war.stakeFloorPct) / 100;
  const stakeNames = stake.map((s) => s.name).join(' and ');
  const outcomes: { title: string; who: number | null; text: string }[] = [
    { title: `If ${attacker.name} wins`, who: attacker.color, text: `${attacker.name} takes ${target.name}.` },
    {
      title: `If ${defender.name} wins`,
      who: defender.color,
      text: `${defender.name} takes the whole stake: ${stakeNames}.`,
    },
    {
      title: 'If it’s a draw',
      who: null,
      text:
        war.draws === 'armageddon'
          ? 'One more game, an Armageddon, decides it.'
          : `The defender holds: nothing changes hands, and ${target.name} stays with ${defender.name}.`,
    },
  ];
  const answers = [
    ...(war.raise === 'off' ? [] : ['raised the stakes']),
    war.redirect === 'nearby' ? `redirected the attack to a country next to ${target.name}` : 'redirected the attack',
  ];
  return (
    <section id="battle" aria-labelledby="battle-heading" className="scroll-mt-4 pt-16 sm:pt-20">
      <SectionHeading id="battle-heading" kicker="A battle, by example">
        The battle for {target.name}
      </SectionHeading>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div className="space-y-4 text-lg leading-relaxed">
          <p className="max-w-[60ch] text-pretty">
            In the sample campaign, {attacker.name} declares war on {target.name}, which {defender.name} holds,
            attacking from {launch.name} next door. One game of chess will decide it, with {attacker.name}, the
            attacker, playing White.
          </p>
          <div className="rounded-[3px] border border-amber/60 bg-amber/5 p-4">
            <h3 className="label text-amber">What the attacker risks</h3>
            <p className="mt-2 max-w-[60ch] text-pretty">
              A stake: the country the attack comes from, plus any of the attacker’s countries connected to it, worth at
              least {war.stakeFloorPct}% of the target, rounded up. {target.name} is worth {target.value}, so the stake
              must be worth at least {floor}.
            </p>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-semibold tabular-nums">
              <span>
                {target.value} × {war.stakeFloorPct}% = {exact.toLocaleString('en')}
              </span>
              <span aria-hidden="true" className="text-muted">
                →
              </span>
              <span className="sr-only">, rounded up to</span>
              <span>
                at least {floor}: {stake.map((s) => `${s.name} ${s.value}`).join(' + ')}
              </span>
            </p>
          </div>
        </div>
        <div>
          <ul role="list" className="space-y-3">
            {outcomes.map((o) => (
              <li key={o.title} className="panel flex items-start gap-3 p-4">
                {o.who === null ? (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 size-[22px] shrink-0 rounded-[2.5px] border border-line-strong"
                  />
                ) : (
                  <EmpireSwatch color={o.who} size={22} className="mt-0.5 shrink-0" />
                )}
                <div>
                  <h3 className="text-lg leading-snug font-bold">{o.title}</h3>
                  <p className="mt-0.5 leading-relaxed">{o.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed text-pretty text-muted">
            {defender.name} could instead have {answers.join(' or ')}
            {war.peaceTerms
              ? ', and either side can offer peace terms until the game ends'
              : ', or offered tribute'}.{' '}
            <Link
              href="/rules#answers"
              className="text-paper underline decoration-line-strong underline-offset-4 hover:decoration-paper"
            >
              How answers work
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function WaysToPlay() {
  const [fastest] = LIVE_CLOCKS;
  const slowest = LIVE_CLOCKS[LIVE_CLOCKS.length - 1]!;
  // In hours throughout, as the answer window is given, so the times compare at a glance.
  const shortest = CORRESPONDENCE_HOURS[0];
  const longest = CORRESPONDENCE_HOURS[CORRESPONDENCE_HOURS.length - 1]!;
  const weakest = BOT_LEVELS[0]!;
  const strongest = BOT_LEVELS[BOT_LEVELS.length - 1]!;
  const ways: { title: string; icon: ReactNode; text: ReactNode }[] = [
    {
      title: 'Live',
      icon: <ClockIcon />,
      text: (
        <>
          Everyone online at once. Battles are played on the clock, {war.liveClock} as standard (hosts choose {fastest}{' '}
          to {slowest}), and the board opens by itself when it’s time to play. Declarations are answered within{' '}
          {RESPONSE_WINDOW_TEXT.live}.
        </>
      ),
    },
    {
      title: 'Correspondence',
      icon: <EnvelopeIcon />,
      text: (
        <>
          Play when it suits you, on a phone or a computer. Each move is due within {war.hoursPerMove} hours as standard
          (hosts choose {shortest} to {longest} hours), and answers within {RESPONSE_WINDOW_TEXT.correspondence}. Turn
          on notifications to hear when it’s your move.
        </>
      ),
    },
    {
      title: 'Bots',
      icon: <BotIcon />,
      text: (
        <>
          Short of players? The host can fill seats with bots, from {weakest.name} (about {weakest.rating}) to{' '}
          {strongest.name} (about {strongest.rating}). They draft, declare, answer and play their own games, and a bot
          can stand in for a player who goes quiet.
        </>
      ),
    },
  ];
  return (
    <section id="ways-to-play" aria-labelledby="ways-heading" className="scroll-mt-4 pt-16 sm:pt-20">
      <SectionHeading id="ways-heading" kicker="Ways to play">
        Live, by correspondence, or with bots
      </SectionHeading>
      <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-pretty">
        The host chooses the pace when starting a campaign, and the time control in the lobby.
      </p>
      <ul role="list" className="mt-6 grid gap-4 md:grid-cols-3">
        {ways.map((w) => (
          <li key={w.title} className="panel p-4">
            <h3 className="flex items-center gap-2.5 text-xl font-bold">
              <span aria-hidden="true" className="text-amber">
                {w.icon}
              </span>
              {w.title}
            </h3>
            <p className="mt-2 leading-relaxed text-pretty">{w.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RulesInBrief() {
  const items: { term: string; text: ReactNode }[] = [
    {
      term: 'A campaign',
      text: (
        <>
          The host creates it and shares the invite link. Once {inWords(MIN_PLAYERS)} or more players are in, the host
          starts the draft, and after it the campaign moves in rounds, each one started by the host.
        </>
      ),
    },
    {
      term: 'War tokens',
      text: (
        <>
          Everyone gains {warTokens(war.tokensPerRound)} a round, up to {war.tokenCap}, and declaring war costs one.
          {war.turns &&
            ` Players declare in turns round the table${war.fortify ? ', and can fortify a country instead' : ''}.`}
        </>
      ),
    },
    {
      term: 'Answers',
      text: (
        <>
          A defender can accept,{war.raise === 'off' ? '' : ' raise the stakes,'} or redirect the attack
          {war.peaceTerms ? ', and either side can offer peace terms' : ', or pay tribute'}. Silence means the war goes
          ahead as declared.
        </>
      ),
    },
    {
      term: 'Diplomacy',
      text: (
        <>
          Talk in the campaign channel or in private, and sign accords that stop two players declaring war on each
          other. Breaking one costs {-REPUTATION_BROKEN} reputation, and everyone sees it.
        </>
      ),
    },
    {
      term: 'Winning',
      text: (
        <>
          The first to {points.toWin} victory points wins
          {lastRound !== null && <>, or whoever has the most once round {lastRound} is over</>}.
        </>
      ),
    },
  ];
  return (
    <section id="rules-in-brief" aria-labelledby="rules-heading" className="scroll-mt-4 pt-16 sm:pt-20">
      <SectionHeading id="rules-heading" kicker="The rules">
        The rules in brief
      </SectionHeading>
      <dl className="mt-6 max-w-3xl divide-y divide-line border-y border-line">
        {items.map(({ term, text }) => (
          <div key={term} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-6">
            <dt className="font-bold">{term}</dt>
            <dd className="leading-relaxed text-pretty">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/rules" className="btn btn-ghost">
          Read the complete rules
        </Link>
        <span className="text-muted">Each round step by step, every answer, deadline, mission and setting.</span>
      </p>
    </section>
  );
}

function ClosingCall({ user }: { user: Session }) {
  return (
    <section aria-labelledby="closing-heading" className="mt-16 sm:mt-20">
      <div className="panel flex flex-col items-center gap-4 px-4 py-10 text-center">
        <Emblem className="size-12" />
        <h2 id="closing-heading" className="font-stencil text-3xl tracking-wide text-balance sm:text-4xl">
          Ready to draw the borders?
        </h2>
        <p className="max-w-[52ch] text-lg leading-relaxed text-pretty text-muted">
          Start a campaign, choose its settings and send the invite link to your group. Got an invite already? Open the
          link to join.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link href={startHref(user)} className="btn btn-amber">
            Start a campaign
          </Link>
          {user ? (
            <Link href="/campaigns" className="btn btn-ghost">
              Your campaigns
            </Link>
          ) : (
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M10 3h4M12 3v3M18.5 6.5l1.5-1.5" strokeLinecap="round" />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" strokeLinejoin="round" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="4.5" y="8" width="15" height="11" rx="2" />
      <path d="M12 4.5V8M9 16h6" strokeLinecap="round" />
      <circle cx="12" cy="3.6" r="1.1" />
      <circle cx="9.2" cy="12.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="12.3" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
