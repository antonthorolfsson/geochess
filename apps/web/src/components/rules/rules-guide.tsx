'use client';

import {
  ACCORD_MAX_ROUNDS,
  ACCORD_MIN_ROUNDS,
  ARMAGEDDON_BLACK_TIME,
  CORRESPONDENCE_HOURS,
  DEFAULT_RULES,
  HOME_TURF_PCT,
  LIVE_CLOCKS,
  MIN_PLAYERS,
  MISSIONS,
  MODIFIER_CAP_PCT,
  PUBLIC_MISSION_KINDS,
  REPUTATION_BROKEN,
  REPUTATION_PER_ROUND,
  REPUTATION_START,
  RESPONSE_WINDOW_TEXT,
  SECRET_MISSION_KINDS,
  SUPPLY_LINE_PCT,
  TERRAIN_PCT,
  durationText,
  holdMs,
  missionRules,
  refillTokens,
  selectionMs,
  stakeFloor,
  type CampaignRules,
} from '@empire/rules';
import Link from 'next/link';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  forRounds,
  hoursText,
  inWords,
  liveClockText,
  perMoveText,
  settingsList,
  stakeTable,
  warTokens,
} from '@/lib/rules-text';

/**
 * - `standard`: the game with the standard settings (the landing page and /rules). Where the two
 *   paces differ, both are described, and the host's settings come last.
 * - `campaign`: one campaign's rules, with its own settings first.
 */
export type RulesGuideProps = { level?: 2 | 3 } & (
  { variant: 'standard' } | { variant: 'campaign'; rules: CampaignRules; settingsNote: string }
);

/** The heading level of the guide's sections; their parts are one below. */
const Level = createContext<2 | 3>(2);

/**
 * How to play, for new players and for reference mid-campaign: each round step by step, then every
 * rule in detail. The numbers come from the rules, so a campaign's page quotes its own settings.
 */
export function RulesGuide(props: RulesGuideProps) {
  const { level = 2 } = props;
  const standard = props.variant === 'standard';
  const rules = props.variant === 'campaign' ? props.rules : DEFAULT_RULES;
  useScrollToHash();
  const settings = (
    <Section id="settings" title={standard ? 'Host settings' : "This campaign's settings"}>
      <p className="text-muted">
        {standard
          ? "The host picks these in the lobby, and they're locked once the draft starts. The rules here use the standard settings:"
          : props.settingsNote}
      </p>
      <Settings rules={rules} />
    </Section>
  );
  const contents = [
    ...(standard ? [] : [{ id: 'settings', label: 'Settings' }]),
    { id: 'idea', label: 'The idea' },
    { id: 'campaign', label: 'A campaign' },
    { id: 'rounds', label: 'Each round' },
    { id: 'declaring', label: 'Declaring war' },
    { id: 'answers', label: 'Answers' },
    { id: 'battle', label: 'The battle' },
    { id: 'after', label: 'After a war' },
    { id: 'diplomacy', label: 'Diplomacy' },
    { id: 'deadlines', label: 'Deadlines' },
    { id: 'ending', label: 'Winning' },
    ...(standard ? [{ id: 'settings', label: 'Settings' }] : []),
  ];
  return (
    <Level value={level}>
      <div className="space-y-10 leading-relaxed">
        <nav aria-label="Rules contents">
          <ul role="list" className="flex flex-wrap gap-1.5">
            {contents.map((item) => (
              <li key={item.id}>
                <Link
                  href={`#${item.id}`}
                  className="inline-flex min-h-9 items-center rounded-[3px] border border-line px-2.5 text-[0.95rem] hover:border-line-strong hover:bg-raised"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {!standard && settings}
        <Idea rules={rules} />
        <StartToFinish rules={rules} />
        <EachRound rules={rules} standard={standard} />
        <DeclaringWar rules={rules} />
        <Answers rules={rules} standard={standard} />
        <Battle rules={rules} standard={standard} />
        <AfterWar rules={rules} standard={standard} />
        <Diplomacy rules={rules} standard={standard} />
        <Deadlines rules={rules} standard={standard} />
        <Victory rules={rules} standard={standard} />
        {standard && settings}
      </div>
    </Level>
  );
}

/** Pages that render once their data arrives miss the browser's own jump to the address's #section. */
function useScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
}

/** How long a player has to answer, and in the standard rules, how long in the other pace. */
function answerTime(rules: CampaignRules, standard: boolean): string {
  const time = RESPONSE_WINDOW_TEXT[rules.war.pace];
  if (!standard) return time;
  const other = rules.war.pace === 'live' ? 'correspondence' : 'live';
  return `${time} (${RESPONSE_WINDOW_TEXT[other]} in ${other} campaigns)`;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const H = `h${useContext(Level)}` as 'h2' | 'h3';
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-4 border-t border-line pt-5">
      <H id={`${id}-heading`} className="text-2xl leading-tight font-bold">
        {title}
      </H>
      <div className="mt-3 space-y-5">{children}</div>
    </section>
  );
}

/** A heading one level below the section's. */
function SubHeading({ className = 'text-lg font-bold', children }: { className?: string; children: ReactNode }) {
  const H = `h${useContext(Level) + 1}` as 'h3' | 'h4';
  return <H className={className}>{children}</H>;
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <SubHeading>{title}</SubHeading>
      {children}
    </div>
  );
}

/** A button or tab named in the text, set the way it appears on screen. */
function UI({ children }: { children: ReactNode }) {
  return <span className="text-[0.85em] font-bold tracking-[0.06em] whitespace-nowrap uppercase">{children}</span>;
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5 marker:text-faint">{children}</ul>;
}

function Settings({ rules }: { rules: CampaignRules }) {
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2">
      {settingsList(rules).map((s) => (
        <div key={s.label} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
          <dt className="text-muted">{s.label}</dt>
          <dd className="text-right font-semibold">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Idea({ rules }: { rules: CampaignRules }) {
  const { war } = rules;
  const players =
    rules.maxPlayers > MIN_PLAYERS ? `${inWords(MIN_PLAYERS)} to ${inWords(rules.maxPlayers)}` : inWords(MIN_PLAYERS);
  const terms: { term: string; text: string }[] = [
    {
      term: 'Value',
      text:
        'Each country is worth 1 to 10, from its real economy, population and area. Most are worth 4 or less; only ' +
        'a handful reach 9 or 10. Empires are ranked by total value.',
    },
    {
      term: 'War tokens',
      text: `Declaring war costs one. Everyone gains ${war.tokensPerRound} when a round starts, and can hold up to ${war.tokenCap}.`,
    },
    {
      term: 'Stake',
      text: `What an attacker risks: the country they attack from, plus connected countries if needed, worth at least ${war.stakeFloorPct}% of the target.`,
    },
  ];
  return (
    <Section id="idea" title="The idea">
      <p className="text-lg">
        {players[0]!.toUpperCase() + players.slice(1)} friends share a world map. Draft countries to build an empire,
        then grow it by declaring war on your neighbors. Every war is settled by one game of chess: if the attacker
        wins, they take the country they attacked; if the defender wins, they take everything the attacker staked.
      </p>
      <dl className="grid gap-3 sm:grid-cols-3">
        {terms.map(({ term, text }) => (
          <div key={term} className="rounded-[3px] border border-line bg-panel p-3">
            <dt className="label">{term}</dt>
            <dd className="mt-1 text-[0.95rem] leading-normal">{text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function StartToFinish({ rules }: { rules: CampaignRules }) {
  const first = refillTokens(rules, 0);
  const stages: { stage: string; text: ReactNode }[] = [
    {
      stage: 'Lobby',
      text: (
        <>
          The host creates the campaign, picks the settings and shares the invite link. Everyone who joins chooses an
          empire color. Once at least {inWords(MIN_PLAYERS)} players are in, the host starts the draft.
        </>
      ),
    },
    {
      stage: 'Draft',
      text: (
        <>
          Take turns claiming countries until the whole map is taken. The order is drawn at random and snakes back each
          round: 1, 2, 3, then 3, 2, 1.{' '}
          {rules.draft.mode === 'contiguous'
            ? 'After your first pick, each country you claim must border your empire, by land or sea lane, while any such country is free.'
            : 'Claim any free country.'}{' '}
          Can't be there? Line up a draft list and turn on Auto-draft. The host can end the draft early, and the rest of
          the map is then drafted automatically: from draft lists first, then the most valuable countries.
        </>
      ),
    },
    ...(rules.victory.mode === 'objectives'
      ? [
          {
            stage: 'Secret missions',
            text: (
              <>
                Each player privately chooses one of up to three secret missions dealt to fit their empire, within{' '}
                {durationText(selectionMs(rules))}. Nobody else sees the options or the choice. See{' '}
                <InlineLink href="#ending">Winning</InlineLink>.
              </>
            ),
          },
        ]
      : []),
    {
      stage: 'War',
      text: (
        <>
          Round 1 starts{' '}
          {rules.victory.mode === 'objectives' ? 'once everyone has a secret mission' : 'the moment the draft ends'},
          and everyone gets {first === 1 ? 'their first war token' : warTokens(first)}. From then on the campaign moves
          in rounds, and the host starts each one.
          {rules.victory.mode === 'objectives' &&
            ` The first to ${missionRules(rules.victory.version).points.toWin} victory points wins.`}
        </>
      ),
    },
  ];
  return (
    <Section id="campaign" title="A campaign, start to finish">
      <ol role="list" className="divide-y divide-line rounded-[3px] border border-line">
        {stages.map(({ stage, text }, i) => (
          <li key={stage} className="grid gap-1 px-4 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4">
            <SubHeading className="label pt-1 text-paper">
              {i + 1}. {stage}
            </SubHeading>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function EachRound({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const answer = answerTime(rules, standard);
  const battle = standard ? (
    <>
      One game of chess, with the attacker playing White: a move a day or so in correspondence campaigns, blitz in live
      ones.
    </>
  ) : war.pace === 'live' ? (
    <>
      One game of live chess at {war.liveClock}, with the attacker playing White. The board opens for both players by
      itself.
    </>
  ) : (
    <>
      One game of chess at {perMoveText(war.hoursPerMove)}, with the attacker playing White. It waits under Your games
      in the Wars tab.
    </>
  );
  const countdowns = [war.truceRounds > 0 && 'truces', war.lockRounds > 0 && 'locks', 'accords'].filter(
    (s): s is string => Boolean(s),
  );
  const countdown = countdowns.slice(0, -1).join(', ') + (countdowns.length > 1 ? ' and ' : '') + countdowns.at(-1);
  const steps: { title: string; who: string; text: ReactNode }[] = [
    {
      title: 'The round begins',
      who: 'Host',
      text: (
        <>
          The host presses <UI>Next round</UI>. Everyone gains {warTokens(war.tokensPerRound)}, up to {war.tokenCap}.{' '}
          {countdown[0]!.toUpperCase() + countdown.slice(1)} count down, and every accord that held through the whole of
          the last round earns both partners {REPUTATION_PER_ROUND} reputation.
        </>
      ),
    },
    {
      title: 'Declare war',
      who: 'Any player',
      text: (
        <>
          Turn on <UI>Targets</UI> to light up every country you can attack. Select one, press <UI>Declare war</UI>,
          choose the country you attack from and build your stake. It costs a war token, and a dashed arrow goes up on
          the map.
        </>
      ),
    },
    {
      title: 'The defender answers',
      who: 'Defender',
      text: (
        <>
          Within {answer}: accept, raise the stake, redirect the attack or pay tribute. With no answer in time, the war
          goes ahead as declared.
        </>
      ),
    },
    {
      title: 'The attacker replies',
      who: 'Attacker',
      text: (
        <>
          Only after a raise, redirect or tribute offer. Within {RESPONSE_WINDOW_TEXT[war.pace]}, the attacker agrees or
          refuses: refusing a raise or redirect calls the war off, and refusing tribute means fighting as declared. With
          no reply, a raise or redirect is refused and a tribute taken.
        </>
      ),
    },
    {
      title: 'The battle',
      who: 'Both players',
      text: <>{battle} The arrow on the map turns solid.</>,
    },
    {
      title: 'The map changes',
      who: 'Automatic',
      text: (
        <>
          If the attacker wins, they take the target. If the defender wins, they take the whole stake.{' '}
          {war.draws === 'armageddon' ? 'A draw goes to an Armageddon game.' : 'A draw changes nothing.'}
          {war.truceRounds > 0 && <> The two players then have a truce {forRounds(war.truceRounds)}.</>}
        </>
      ),
    },
    {
      title: 'The next round',
      who: 'Host',
      text: (
        <>
          When the group is ready, the host starts the next round. There's no timer. Unfinished wars carry on into it,
          and unused tokens are kept.
        </>
      ),
    },
  ];
  return (
    <Section id="rounds" title="Each round, step by step">
      <p>
        Rounds have no turns. Within a round, everyone acts whenever they like: declare as many wars as your tokens
        allow, and answer the ones declared on you. Here is how a round, and each war in it, plays out.
      </p>
      <ol role="list">
        {steps.map((step, i) => (
          <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="absolute top-12 bottom-2 left-5 w-px bg-line-strong" />
            )}
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-[3px] border border-line-strong bg-panel text-lg font-bold tabular-nums"
            >
              {i + 1}
            </span>
            <div className="min-w-0 pt-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <SubHeading className="text-lg leading-snug font-bold">{step.title}</SubHeading>
                <span className="label">{step.who}</span>
              </div>
              <p className="mt-1">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-l-2 border-amber/60 pl-3">
        <strong>All round long:</strong> talk in the Diplo tab, sign accords so a neighbor can't attack you, or break
        one to strike first, at a cost to your reputation. See <InlineLink href="#diplomacy">Diplomacy</InlineLink>.
      </p>
    </Section>
  );
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="underline decoration-line-strong underline-offset-2 hover:decoration-paper">
      {children}
    </Link>
  );
}

function DeclaringWar({ rules }: { rules: CampaignRules }) {
  const { war } = rules;
  const example = stakeFloor(rules, 6);
  return (
    <Section id="declaring" title="Declaring war">
      <Part title="What you can attack">
        <p>A country held by another player, when:</p>
        <Bullets>
          <li>it borders one of your countries, by land or across a sea lane (the dotted lines on the water);</li>
          <li>it isn't already caught up in a war;</li>
          <li>you have no truce or accord with its owner, and haven't broken an accord with them this round;</li>
          <li>one of your countries bordering it can launch the attack with a big enough stake.</li>
        </Bullets>
        <p className="text-muted">
          <UI>Targets</UI> lights up every country that qualifies; you also need a war token to declare. Select any
          other country to see why you can't attack it.
        </p>
      </Part>
      <Part title="Where you attack from">
        <p>
          One of your countries bordering the target, as long as it isn't caught up in another war
          {war.lockRounds > 0 ? (
            <>
              {' '}
              or newly won (see <InlineLink href="#after">After a war</InlineLink>).
            </>
          ) : (
            '.'
          )}
        </p>
      </Part>
      <Part title="The stake">
        <p>
          Your stake is what you risk: the country you attack from, plus any of your countries connected to it, together
          worth at least {war.stakeFloorPct}% of the target's value, rounded up. There's no upper limit. Win and you
          take the target; lose and the defender takes the whole stake.
        </p>
        <StakeTable rules={rules} />
        <p className="text-muted">
          A target worth 6 needs a stake of at least {example}: say, the country you attack from, worth {example - 2},
          and a connected one worth 2. The stake builder suggests the cheapest stake, and you can add or remove
          countries before you declare.
        </p>
      </Part>
    </Section>
  );
}

function StakeTable({ rules }: { rules: CampaignRules }) {
  const rows = stakeTable(rules);
  const cell = 'px-1 py-1.5 text-center tabular-nums';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] table-fixed text-[0.95rem] leading-tight">
        <caption className="sr-only">The least a stake can be worth, against each target value</caption>
        <thead>
          <tr className="border-b border-line-strong">
            <th scope="col" className="label w-24 py-1.5 pr-2 text-left sm:w-36">
              Target's value
            </th>
            {rows.map((r) => (
              <th key={r.value} scope="col" className={`${cell} font-bold`}>
                {r.value}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          <tr>
            <th scope="row" className="label py-1.5 pr-2 text-left">
              Least stake
            </th>
            {rows.map((r) => (
              <td key={r.value} className={cell}>
                {r.stake}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="label py-1.5 pr-2 text-left">
              After a raise
            </th>
            {rows.map((r) => (
              <td key={r.value} className={`${cell} text-muted`}>
                {r.raised}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Answers({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const answers: { label: string; text: string }[] = [
    { label: 'Accept', text: 'The game is on, for the target and the stake as declared.' },
    {
      label: 'Raise',
      text:
        `Demand a bigger stake: at least ${war.raisePct}% of the target's value (the table above has the numbers). ` +
        'Only possible while the stake is worth less than that. The attacker raises the stake or withdraws.',
    },
    {
      label: 'Redirect',
      text:
        'Offer another of your countries, worth the same and also bordering the attacker, to fight over instead. ' +
        'The stake stays as declared. The attacker fights for it or withdraws.',
    },
    {
      label: 'Pay tribute',
      text:
        'Offer one of your countries worth less than the target, or some of your war tokens. The attacker takes it ' +
        'and the war is over, or refuses and fights as declared, with no more counter-offers.',
    },
  ];
  return (
    <Section id="answers" title="Answering a declaration">
      <p>
        The defender answers in the Wars tab, under Waiting for your answer, within {answerTime(rules, standard)}. With
        no answer, the war goes ahead as declared.
      </p>
      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {answers.map(({ label, text }) => (
          <li key={label} className="rounded-[3px] border border-line bg-panel p-3">
            <SubHeading className="text-[0.95rem] font-bold tracking-[0.06em] uppercase">{label}</SubHeading>
            <p className="mt-1 text-[0.95rem] leading-normal">{text}</p>
          </li>
        ))}
      </ul>
      <Part title="The attacker's reply">
        <p>A counter-offer goes back to the attacker, who has {RESPONSE_WINDOW_TEXT[war.pace]} to reply:</p>
        <Bullets>
          <li>
            to a raise: <UI>Raise the stake</UI> to at least the amount demanded, or <UI>Withdraw</UI>;
          </li>
          <li>
            to a redirect: <UI>Fight for</UI> the offered country, or <UI>Withdraw</UI>;
          </li>
          <li>
            to a tribute offer: <UI>Accept tribute</UI>, or <UI>Refuse and fight</UI> as declared.
          </li>
        </Bullets>
        <p>
          With no reply, a raise or redirect is withdrawn and a tribute is accepted. Withdrawing calls the war off:
          nothing changes hands, no truce follows, and the war token is spent.
        </p>
      </Part>
      <Part title="Countries caught up in a war">
        <p>
          From the declaration until the war ends, the target, the stake and any country offered as a redirect or
          tribute are tied up: nobody can attack them, stake them or offer them in another war. Tokens offered as
          tribute are set aside until the attacker replies.
        </p>
      </Part>
    </Section>
  );
}

function Battle({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const shortest = CORRESPONDENCE_HOURS[0];
  const longest = CORRESPONDENCE_HOURS[CORRESPONDENCE_HOURS.length - 1]!;
  const correspondence = (
    <>
      Each move is due within{' '}
      {standard ? `a set time (${hoursText(war.hoursPerMove)} as standard)` : hoursText(war.hoursPerMove)}, and running
      out of time loses. The game starts as soon as the war is on, and waits under Your games in the Wars tab.
    </>
  );
  const live = (clock: typeof war.liveClock) => (
    <>
      Blitz at {clock}: {liveClockText(clock)}. The board opens by itself after a short countdown. You play one live
      game at a time; any others wait their turn.
    </>
  );
  // An example worth reading: a mountain or island target with three of the attacker's countries on its border.
  const defenderEdge = HOME_TURF_PCT + TERRAIN_PCT;
  const attackerEdge = 3 * SUPPLY_LINE_PCT;
  return (
    <Section id="battle" title="The battle">
      <p>One game of standard chess, with the attacker playing White.</p>
      {standard ? (
        <dl className="divide-y divide-line rounded-[3px] border border-line">
          <div className="px-4 py-3">
            <dt className="font-bold">Correspondence campaigns</dt>
            <dd>
              About a move a day, for campaigns that run for weeks. {correspondence} Hosts choose from{' '}
              {hoursText(shortest)} to {hoursText(longest)} per move.
            </dd>
          </div>
          <div className="px-4 py-3">
            <dt className="font-bold">Live campaigns</dt>
            <dd>
              For game nights with everyone online. {live(war.liveClock)} Hosts choose from {LIVE_CLOCKS[0]} to{' '}
              {LIVE_CLOCKS[LIVE_CLOCKS.length - 1]}.
            </dd>
          </div>
        </dl>
      ) : (
        <p>
          <strong>This campaign is {war.pace === 'live' ? 'live' : 'played by correspondence'}.</strong>{' '}
          {war.pace === 'live' ? live(war.liveClock) : correspondence}
        </p>
      )}
      <Part title="Clock modifiers">
        {war.clockModifiers ? (
          <>
            <p>The side with the edge gets extra time:</p>
            <Bullets>
              <li>
                the defender, +{HOME_TURF_PCT}% for home turf, and +{TERRAIN_PCT}% more if the target is mountainous or
                an island;
              </li>
              <li>
                the attacker, +{SUPPLY_LINE_PCT}% for each of their countries bordering the target (supply lines).
              </li>
            </Bullets>
            <p>
              The two cancel out, and what's left, up to {MODIFIER_CAP_PCT}%, goes to one side: more starting time and
              increment in live games, more time per move in correspondence. Attack a mountainous target that three of
              your countries border, and the defender's +{defenderEdge}% against your +{attackerEdge}% leaves them{' '}
              {defenderEdge - attackerEdge}% more time. The stake builder shows the clocks before you declare.
            </p>
          </>
        ) : (
          <p>Off in this campaign: both players always get the same time.</p>
        )}
      </Part>
      <Part title="How games end">
        <p>
          By checkmate, resignation or running out of time. Stalemate, threefold repetition, fifty moves without a
          capture or pawn move, and positions where neither side can checkmate are drawn at once, with nothing to claim.
          Running out of time is a draw, not a loss, if your opponent has too little left to ever checkmate. You can
          offer a draw from the board; making a move declines your opponent's offer.
        </p>
      </Part>
    </Section>
  );
}

function AfterWar({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const blackTime = `${Math.round(ARMAGEDDON_BLACK_TIME * 100)}%`;
  const armageddon =
    `colors swap, so the defender plays White and must win, while the attacker plays Black with ${blackTime} ` +
    "of White's time and takes the war with a draw";
  const draw =
    war.draws === 'armageddon'
      ? `One more game, an Armageddon, decides it: ${armageddon}.`
      : standard
        ? `The defender holds: nothing changes hands. Hosts can choose Armageddon instead, one more game in which ${armageddon}.`
        : 'The defender holds: nothing changes hands.';
  const outcomes: [string, string][] = [
    ['Attacker wins', 'The attacker takes the target.'],
    ['Defender wins', 'The defender takes the whole stake.'],
    ['Draw', draw],
    ['Tribute accepted', 'The country or tokens offered go to the attacker.'],
    ['Withdrawn', "Nothing changes hands, and the attacker's war token is spent."],
  ];
  return (
    <Section id="after" title="After a war">
      <dl className="divide-y divide-line rounded-[3px] border border-line">
        {outcomes.map(([outcome, text]) => (
          <div key={outcome} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="font-bold">{outcome}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <Part title="Truce">
        <p>
          {war.truceRounds > 0
            ? `Once a war is fought or settled by tribute, its two players can't declare war on each other ${forRounds(war.truceRounds)}. A withdrawn war brings no truce.`
            : 'There are no truces: the two players may declare war on each other again at once.'}
        </p>
      </Part>
      <Part title="Newly won countries">
        <p>
          {war.lockRounds > 0
            ? `A country won in a war or taken as tribute can't be staked, or attacked from, ${forRounds(war.lockRounds)}. It can still be attacked.`
            : 'Countries won in a war or taken as tribute can be staked straight away.'}
        </p>
      </Part>
    </Section>
  );
}

function Diplomacy({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  return (
    <Section id="diplomacy" title="Diplomacy">
      <Part title="Talk">
        <p>
          The Diplo tab has a channel for the whole campaign, private messages between any two players, and dispatches
          reporting every war, accord and new round.
        </p>
      </Part>
      <Part title="Accords">
        <p>
          An accord is a promise between two players not to attack each other, for {ACCORD_MIN_ROUNDS} to{' '}
          {ACCORD_MAX_ROUNDS} rounds. Propose one under Accords in the Diplo tab; only the two of you see the proposal.
          The other player signs or declines within {answerTime(rules, standard)}, or it lapses. Signed accords are
          public, and while one holds, neither partner can declare war on the other. Wars already underway carry on.
        </p>
        <p>
          Terms are optional: everyone can read them, but the game doesn't enforce them. To extend an accord, sign a new
          one with the same partner. Accords can be signed from the start of the draft.
        </p>
      </Part>
      <Part title="Breaking an accord">
        <p>
          Either partner can <UI>Renounce</UI> an accord at any time. It ends at once and everyone is told. The breaker
          loses {-REPUTATION_BROKEN} reputation and can't declare war on the former partner for the rest of the round,
          but the betrayed player may strike straight away.
        </p>
      </Part>
      <Part title="Reputation">
        <p>
          Everyone starts with {REPUTATION_START}. Each whole round an accord holds earns both partners{' '}
          {REPUTATION_PER_ROUND}, paid when the next round starts; breaking one costs {-REPUTATION_BROKEN}. Reputation
          doesn't change what you can do. It shows everyone who keeps their word.
        </p>
      </Part>
    </Section>
  );
}

function Victory({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  if (rules.victory.mode === 'open') {
    return (
      <Section id="ending" title="Winning">
        <p>
          This campaign is open-ended: play for as long as your group likes. The standings rank empires by total value,
          and every empire's page keeps its history, war record and chess profile.
        </p>
      </Section>
    );
  }
  const cfg = missionRules(rules.victory.version);
  const { points } = cfg;
  const hold = durationText(holdMs(rules));
  const holdOther = standard
    ? ` (${durationText(cfg.holdMinutes[rules.war.pace === 'live' ? 'correspondence' : 'live'] * 60_000)} in ${
        rules.war.pace === 'live' ? 'correspondence' : 'live'
      } campaigns)`
    : '';
  const chosen = rules.victory.publicMissions.map((m) => MISSIONS[m.kind].name);
  const secretKinds = SECRET_MISSION_KINDS.filter((k) => k !== 'measured_expansion');
  return (
    <Section id="ending" title="Winning">
      <p className="text-lg">
        The first to {points.toWin} victory points wins. Four public missions are worth {points.public} points each and
        every player has one secret mission worth {points.secret}: two public missions and the secret make{' '}
        {points.public * 2 + points.secret}, and all four public ones make {points.public * 4}, so a player can win
        without their secret.
        {!standard && ' (The host can instead make a campaign open-ended in the lobby: no missions and no fixed end.)'}
      </p>
      <Part title="Public missions">
        <p>
          Everyone can see them from the lobby on, with their exact targets, and everyone can score each one once:
          someone else scoring a mission takes nothing from you. Countries you draft count toward them, but nothing
          scores during the draft.
        </p>
        {standard ? (
          <>
            <p>
              New campaigns play Expansion, Strategic Positions, The Great Connection and Campaign Veteran. The host can
              pick any other four before the draft, and draw new targets for them:
            </p>
            <MissionList kinds={PUBLIC_MISSION_KINDS} />
          </>
        ) : (
          <p>
            This campaign plays {chosen.join(', ')}. Their targets are in the <UI>Missions</UI> tab, which can show each
            one on the map.
          </p>
        )}
      </Part>
      <Part title="Secret missions">
        <p>
          When the draft ends, each player is dealt up to three secret options that fit their empire (each at least two
          conquests from done), chooses one within {durationText(selectionMs(rules))}, and can't change it. Anyone still
          choosing when time runs out gets the best fit. Other players see only that you're ready.
        </p>
        <p>
          A secret mission is revealed to everyone, with its exact targets, when you come within one step of it: for
          most missions, holding all but one target, or one conquest away. Completing it always reveals it. Once
          revealed it stays public, even if you lose ground.
        </p>
        <MissionList kinds={secretKinds} />
        <p className="text-muted">
          If fewer than three fit, Measured Expansion fills in: gain {cfg.measuredExpansion.gain} value over your draft,
          with {cfg.measuredExpansion.newCount} new countries. If nothing fits at all, the host decides whether that
          player goes on without one.
        </p>
      </Part>
      <Part title="Claims: holding a position">
        <p>
          Most missions are positions to hold. When you complete one, it becomes a public claim, and every player can
          see what you must hold. It scores only when all of these are true:
        </p>
        <Bullets>
          <li>
            the round after next has started: a claim made in round 3 can score from round 5, never sooner, so every
            rival gets a whole round to respond;
          </li>
          <li>
            at least {hold}
            {holdOther} have passed since the next round started, so a host can't rush the rounds (the host can make
            this time longer in the lobby, never shorter);
          </li>
          <li>you have held it the whole time; and</li>
          <li>no war you're in could still break it. A war that can't touch it doesn't matter.</li>
        </Bullets>
        <p>
          Lose the position and the claim ends; complete it again and a new claim starts. Swapping which targets you
          hold doesn't end a claim, as long as the mission never stops being complete. Campaign Veteran is a record, not
          a position: it scores the moment you win the third war.
        </p>
      </Part>
      <Part title="Points and the finish">
        <p>
          Points are never taken away: losing a country after a mission has scored costs nothing. When several players
          reach {points.toWin} with the same change, the highest total wins, and equal totals share the victory.
        </p>
        <p>
          The campaign then ends and can no longer change: wars still underway are cancelled without a winner (their
          moves are kept), tokens offered as tribute go back, and every secret mission is revealed in the final results.
        </p>
      </Part>
    </Section>
  );
}

function MissionList({ kinds }: { kinds: readonly (keyof typeof MISSIONS)[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {kinds.map((kind) => (
        <div key={kind} className="border-b border-line pb-2">
          <dt className="font-semibold">
            {MISSIONS[kind].name}
            {MISSIONS[kind].long && (
              <span className="ml-2 text-xs font-normal text-muted uppercase">Long campaign</span>
            )}
            {MISSIONS[kind].freeDraftOnly && (
              <span className="ml-2 text-xs font-normal text-muted uppercase">Free drafts</span>
            )}
          </dt>
          <dd className="text-[0.95rem] text-muted">{MISSIONS[kind].summary}</dd>
        </div>
      ))}
    </dl>
  );
}

function Deadlines({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const answer = RESPONSE_WINDOW_TEXT[war.pace];
  const rows: [who: string, time: string, silence: string][] = [
    ['The defender answers a declaration', answer, 'The war goes ahead as declared.'],
    ['The attacker replies to a raise or redirect', answer, 'The war is called off, and the token is spent.'],
    ['The attacker replies to a tribute offer', answer, 'The tribute is accepted.'],
    ['A player answers an accord proposal', answer, 'The proposal lapses.'],
    ['A player moves', war.pace === 'live' ? 'Their clock' : perMoveText(war.hoursPerMove), 'They lose the game.'],
    ...(rules.victory.mode === 'objectives'
      ? [
          [
            'A player chooses a secret mission',
            durationText(selectionMs(rules)),
            'The option that fits them best is chosen for them.',
          ] as [string, string, string],
        ]
      : []),
  ];
  return (
    <Section id="deadlines" title="Deadlines at a glance">
      <p>
        Silence is an answer too.{' '}
        {standard &&
          `The times below are for correspondence campaigns; in live ones, answers are due within ${RESPONSE_WINDOW_TEXT.live} and moves on the clock.`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-left text-[0.95rem] leading-snug">
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="label py-1.5 pr-3">
                Waiting for
              </th>
              <th scope="col" className="label py-1.5 pr-3">
                Time
              </th>
              <th scope="col" className="label py-1.5">
                If time runs out
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([who, time, silence]) => (
              <tr key={who} className="align-top">
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {who}
                </th>
                <td className="py-2 pr-3">{time}</td>
                <td className="py-2 text-muted">{silence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted">
        Turn on Notifications on this device in the Wars tab to hear about wars declared on you, counter-offers and your
        moves. On an iPhone, add Geo Chess to your home screen first.
      </p>
    </Section>
  );
}
