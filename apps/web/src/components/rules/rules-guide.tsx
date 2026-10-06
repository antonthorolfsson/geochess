'use client';

import {
  ACCORD_MAX_ROUNDS,
  ACCORD_MIN_ROUNDS,
  ARMAGEDDON_BLACK_TIME,
  BOT_LEVELS,
  CORRESPONDENCE_HOURS,
  DEFAULT_RULES,
  FORTIFY_COST,
  FORTIFY_ROUNDS,
  HANDICAP_CAP_PCT,
  HANDICAP_MIN_GAP,
  HANDICAP_PCT_PER_100,
  HOME_TURF_PCT,
  LIVE_CLOCKS,
  MATCHED_RAISE_MIN_PCT,
  MAX_VALUE,
  MIN_PLAYERS,
  MISSIONS,
  MODIFIER_CAP_PCT,
  type MissionKind,
  type MissionRules,
  REPUTATION_BROKEN,
  REPUTATION_PER_ROUND,
  REPUTATION_START,
  RESPONSE_WINDOW_TEXT,
  TITLES,
  SUPPLY_LINE_PCT,
  TERRAIN_PCT,
  TURN_WINDOW_TEXT,
  durationText,
  holdMs,
  holdsByTurns,
  isLongMission,
  joinWords,
  kindName,
  lastRoundOf,
  missionName,
  missionRules,
  missionSummary,
  refillTokens,
  reservesAllowed,
  selectionMs,
  stakeFloor,
  tiebreakText,
  topValueOf,
  type CampaignRules,
} from '@empire/rules';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import {
  forRounds,
  hoursText,
  inWords,
  liveClockText,
  perMoveText,
  raisedRowLabel,
  settingsList,
  stakeTable,
  warTokens,
} from '@/lib/rules-text';

/** "a, b or c". */
const orWords = (items: readonly string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

/**
 * - `standard`: the game with the standard settings (/rules). Where the two paces differ, both are
 *   described, and the host's settings come last.
 * - `campaign`: one campaign's rules, with its own settings first.
 */
export type RulesGuideProps =
  { variant: 'standard' } | { variant: 'campaign'; rules: CampaignRules; datasetVersion: string; settingsNote: string };

/**
 * How to play, for new players and for reference mid-campaign: each round step by step, then every
 * rule in detail. The numbers come from the rules, so a campaign's page quotes its own settings.
 */
export function RulesGuide(props: RulesGuideProps) {
  const standard = props.variant === 'standard';
  const rules = props.variant === 'campaign' ? props.rules : DEFAULT_RULES;
  // Campaigns keep the values of the map they started on; new ones run 1 to 20.
  const top = props.variant === 'campaign' ? topValueOf(props.datasetVersion) : MAX_VALUE;
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
    { id: 'bots', label: 'Bots' },
    { id: 'deadlines', label: 'Deadlines' },
    { id: 'ending', label: 'Winning' },
    ...(standard ? [{ id: 'settings', label: 'Settings' }] : []),
  ];
  return (
    <div className="readable space-y-10 leading-relaxed">
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
      <Idea rules={rules} top={top} />
      <StartToFinish rules={rules} />
      <EachRound rules={rules} standard={standard} />
      <DeclaringWar rules={rules} standard={standard} top={top} />
      <Answers rules={rules} standard={standard} />
      <Battle rules={rules} standard={standard} />
      <AfterWar rules={rules} standard={standard} />
      <Diplomacy rules={rules} standard={standard} />
      <Bots />
      <Deadlines rules={rules} standard={standard} />
      <Victory rules={rules} standard={standard} />
      {standard && settings}
    </div>
  );
}

/** Pages that render once their data arrives miss the browser's own jump to the address's #section. */
function useScrollToHash() {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    let id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch {
      // A malformed escape (#%E0%A4) matches no section, but mustn't break the page.
    }
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

/** How long a turn to declare lasts, for this campaign or (standard) both paces. */
function turnTime(rules: CampaignRules, standard: boolean): string {
  const time = TURN_WINDOW_TEXT[rules.war.pace];
  if (!standard) return time;
  const other = rules.war.pace === 'live' ? 'correspondence' : 'live';
  return `${time} (${TURN_WINDOW_TEXT[other]} in ${other} campaigns)`;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-4 border-t border-line pt-5">
      <h2 id={`${id}-heading`} className="text-2xl leading-tight font-bold">
        {title}
      </h2>
      <div className="mt-3 space-y-5">{children}</div>
    </section>
  );
}

/** A heading one level below the section's. */
function SubHeading({ className = 'text-lg font-bold', children }: { className?: string; children: ReactNode }) {
  return <h3 className={className}>{children}</h3>;
}

function Part({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4 space-y-2">
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

function Idea({ rules, top }: { rules: CampaignRules; top: number }) {
  const { war } = rules;
  const players =
    rules.maxPlayers > MIN_PLAYERS ? `${inWords(MIN_PLAYERS)} to ${inWords(rules.maxPlayers)}` : inWords(MIN_PLAYERS);
  const terms: { term: string; text: string }[] = [
    {
      term: 'Value',
      text:
        top === 10
          ? 'Each country is worth 1 to 10, from its real economy, population and area. Most are worth 4 or less; ' +
            'only a handful reach 9 or 10. Empires are ranked by total value.'
          : `Each country is worth 1 to ${top}, from its real economy, population and area. Most are worth 4 or ` +
            `less; about a dozen great powers are worth 13 or more, and only China and the United States reach ${top}. ` +
            'Empires are ranked by total value.',
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
            missionRules(rules.victory.version).titles &&
            ' The titles go to whoever leads the table on population, land, GDP and military might.'}
          {rules.victory.mode === 'objectives' &&
            ` The first to ${missionRules(rules.victory.version).points.toWin} victory points wins${
              lastRoundOf(rules) === null ? '' : `, or the most points once round ${lastRoundOf(rules)} is over`
            }.`}
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
          {lastRoundOf(rules) !== null && (
            <>
              {' '}
              After round {lastRoundOf(rules)}, the campaign’s last, the host presses <UI>End the campaign</UI> instead.
            </>
          )}
        </>
      ),
    },
    {
      title: 'Declare war',
      who: war.turns ? 'Each player in turn' : 'Any player',
      text: (
        <>
          {war.turns ? 'On your turn, switch' : 'Turn'} on <UI>Targets</UI> to light up every country you can attack.
          Select one, press <UI>Declare war</UI>, choose the country you attack from and build your stake
          {reservesAllowed(rules) ? ', with any countries you want to set aside in reserve to meet a raise' : ''}. It
          costs a war token, and a dashed arrow goes up on the map.
          {war.recall && ' Until the defender answers, you can still call it off, though the token stays spent.'}
          {war.turns && (
            <>
              {' '}
              Then the turn moves on round the table. When it comes back, declare again
              {war.fortify ? ', fortify a country' : ''} or <UI>Pass</UI>, which ends your declaring for the round.
            </>
          )}
        </>
      ),
    },
    {
      title: 'The defender answers',
      who: 'Defender',
      text: (
        <>
          Within {answer}:{' '}
          {orWords([
            'accept',
            ...(war.raise === 'off' ? [] : ['raise the stakes']),
            'redirect the attack',
            ...(war.peaceTerms ? [] : ['pay tribute']),
          ])}
          . With no answer in time, the war goes ahead as declared.
          {war.peaceTerms &&
            ' Either player can also offer peace terms, now or at any time until the game ends: accepted, they end the war.'}
        </>
      ),
    },
    {
      title: 'The attacker replies',
      who: 'Attacker',
      text: (
        <>
          Only after{' '}
          {orWords([
            ...(war.raise === 'off' ? [] : ['a raise']),
            'a redirect',
            ...(war.peaceTerms ? [] : ['a tribute offer']),
          ])}
          . Within {RESPONSE_WINDOW_TEXT[war.pace]}, the attacker agrees or refuses: refusing{' '}
          {war.raise === 'off' ? 'a redirect' : 'a raise or redirect'} calls the war off
          {war.peaceTerms ? '' : ', and refusing tribute means fighting as declared'}. With no reply,{' '}
          {war.raise === 'off' ? 'a redirect is' : 'a raise or redirect is'} refused
          {war.peaceTerms ? '' : ' and a tribute taken'}.
          {reservesAllowed(rules) && ' A raise the attacker’s reserves cover is met at once, without waiting.'}
          {backAndForth(rules) &&
            ` The attacker can also raise again, and the defender then meets it, raises again or backs down, up to ${war.raises} raises in all. Whoever has raised and then backs down, or lets the time run out, loses the war as declared.`}
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
          If the attacker wins, they take the target
          {war.raise === 'matched' ? ', and any country a raise put in' : ''}. If the defender wins, they take the whole
          stake.
          {backAndForth(rules) && ' A side that backed down after raising hands over the war as declared instead.'}{' '}
          {war.draws === 'armageddon' ? 'A draw goes to an Armageddon game.' : 'A draw changes nothing.'}
          {war.peaceTerms && ' Peace terms, once accepted, stop the game and hand over what they name instead.'}
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
      {war.turns ? (
        <p>
          Players take turns to declare war, round the table: on your turn, declare one war
          {war.fortify ? ', fortify one of your countries' : ''} or pass, within {turnTime(rules, standard)}. Passing
          ends your declaring for the round, and the turns go round until everyone has passed or has no tokens left.
          Everything else (answering, playing your games, diplomacy) happens whenever you like. Here is how a round, and
          each war in it, plays out.
        </p>
      ) : (
        <p>
          Rounds have no turns. Within a round, everyone acts whenever they like: declare as many wars as your tokens
          allow, and answer the ones declared on you. Here is how a round, and each war in it, plays out.
        </p>
      )}
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
        {war.fortify && (
          <>
            {' '}
            {war.turns ? 'On your turn, you can instead spend' : 'Spend'} a war token to fortify a country a neighbor
            might want: see <InlineLink href="#fortifying">Fortifying</InlineLink>.
          </>
        )}
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

function DeclaringWar({ rules, standard, top }: { rules: CampaignRules; standard: boolean; top: number }) {
  const { war } = rules;
  const example = stakeFloor(rules, 6);
  return (
    <Section id="declaring" title="Declaring war">
      {war.turns && (
        <Part title="Taking turns">
          <p>
            Players declare one at a time, so nobody gets the best targets just by being quickest. The order follows the
            draft&apos;s seats round the table, and each round it starts one seat further along: round 1 with whoever
            drafted last, round 2 with whoever drafted first, and so on. On your turn, declare one war
            {war.fortify ? ', fortify one of your countries' : ''} or pass; then the turn moves on. Passing ends your
            declaring for the round, and anyone with no tokens left
            {war.fortify ? ', or nothing to attack or fortify,' : ' or nothing to attack'} is passed over. Once everyone
            is done, declaring is over until the next round.
          </p>
          <p className="text-muted">
            A turn lasts up to {turnTime(rules, standard)}; after that it passes for you. The host can pass the turn for
            a player who is away. The war room shows the order and whose turn it is.
          </p>
        </Part>
      )}
      <Part title="What you can attack">
        <p>A country held by another player, when:</p>
        <Bullets>
          <li>it borders one of your countries, by land or across a sea lane (the dotted lines on the water);</li>
          <li>it isn't already caught up in a war;</li>
          <li>you have no truce or accord with its owner, and haven't broken an accord with them this round;</li>
          <li>
            one of your countries bordering it can launch the attack with a big enough stake
            {war.fortify ? ' (a bigger one if it’s fortified)' : ''}.
          </li>
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
        <StakeTable rules={rules} top={top} />
        <p className="text-muted">
          A target worth 6 needs a stake of at least {example}: say, the country you attack from, worth {example - 2},
          and a connected one worth 2. The stake builder suggests the cheapest stake, and you can add or remove
          countries before you declare.
        </p>
      </Part>
      {reservesAllowed(rules) && (
        <Part title="Reserves">
          <p>
            When you declare, you can also set countries aside to meet a raise: your own, joined to the stake. If the
            defender raises and your reserves can bring the stake up to what the raise demands, they&apos;re added at
            once (the cheapest that will do) and the war goes ahead without waiting for you. If they can&apos;t, you
            answer the raise as usual. Everyone can see your reserves, and they&apos;re tied up until the answer is
            settled; whatever the raise doesn&apos;t need is free again.
          </p>
        </Part>
      )}
      {war.recall && (
        <Part title="Calling it off">
          <p>
            Changed your mind? Until the defender answers, <UI>Call off</UI> ends the war at once: nothing changes hands
            and no truce follows, but the war token stays spent. Once the defender has answered, the declaration stands.
          </p>
        </Part>
      )}
      {war.fortify && (
        <Part title="Fortifying" id="fortifying">
          <p>
            {war.turns ? 'On your turn, instead of declaring war, you' : 'Any player'} can spend{' '}
            {warTokens(FORTIFY_COST)} to fortify one of {war.turns ? 'your' : 'their'} countries, from its panel. Until{' '}
            {FORTIFY_ROUNDS === 2 ? 'the round after next' : `${FORTIFY_ROUNDS} more rounds`} starts, a war on it needs
            a stake of at least {war.raisePct}% of its value instead of {war.stakeFloorPct}% (the table&apos;s second
            row). Fortified countries carry a rampart on the map, so everyone knows before declaring. Fortifying again
            in a later round extends it. It ends early if the country changes hands, and a war declared before it keeps
            its stake.
          </p>
        </Part>
      )}
    </Section>
  );
}

function StakeTable({ rules, top }: { rules: CampaignRules; top: number }) {
  const rows = stakeTable(rules, top);
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
          {raisedRowLabel(rules) && (
            <tr>
              <th scope="row" className="label py-1.5 pr-2 text-left">
                {raisedRowLabel(rules)}
              </th>
              {rows.map((r) => (
                <td key={r.value} className={`${cell} text-muted`}>
                  {r.raised}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Whether the campaign's stakes can be raised back and forth. */
const backAndForth = (rules: CampaignRules) => rules.war.raise === 'matched' && rules.war.raises > 1;

function Answers({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const raise = ((): { label: string; text: string } | null => {
    switch (war.raise) {
      case 'matched':
        return {
          label: 'Raise',
          text:
            `Put one of your own countries into the war, worth ${MATCHED_RAISE_MIN_PCT}% to 100% of the target's value ` +
            'and free of other wars. The attacker must add at least as much to the stake, or withdraw; if they win, ' +
            "they take it along with the target. It's a bet on the game: worth making when you expect to win." +
            (backAndForth(rules)
              ? ` The attacker may raise back, up to ${war.raises} raises in all, and once you have raised, backing down hands them the target.`
              : ''),
        };
      case 'token':
        return {
          label: 'Raise',
          text:
            `Pay a war token to demand a stake of at least ${war.raisePct}% of the target's value (the table above ` +
            'has the numbers), while the stake is worth less than that. The attacker raises the stake, and takes your ' +
            'token for it, or withdraws, and both tokens are spent.',
        };
      case 'free':
        return {
          label: 'Raise',
          text:
            `Demand a bigger stake: at least ${war.raisePct}% of the target's value (the table above has the numbers). ` +
            'Only possible while the stake is worth less than that. The attacker raises the stake or withdraws.',
        };
      case 'off':
        return null;
    }
  })();
  const nearby = war.redirect === 'nearby';
  const answers: { label: string; text: string }[] = [
    { label: 'Accept', text: 'The game is on, for the target and the stake as declared.' },
    ...(raise ? [raise] : []),
    {
      label: 'Redirect',
      text:
        `Offer another of your countries${nearby ? ' next to the target' : ''}, worth the same and also bordering the ` +
        `attacker, to fight over instead. The stake stays as declared${nearby ? ", and so does the clock: the war keeps the first target's clock modifiers" : ''}. ` +
        (war.redirectToken ? 'It costs you a war token, which the attacker gets for fighting on. ' : '') +
        'The attacker fights for it or withdraws.',
    },
    war.peaceTerms
      ? {
          label: 'Peace terms',
          text:
            'Not an answer, and open to both sides until the game ends: offer terms to end the war, from handing over ' +
            'a country to a white peace. See Peace terms below.',
        }
      : {
          label: 'Pay tribute',
          text:
            'Offer one of your countries worth less than the target, or some of your war tokens. The attacker takes it ' +
            'and the war is over, or refuses and fights as declared, with no more counter-offers.',
        },
  ];
  const counters = [...(war.raise === 'off' ? [] : ['raise']), 'redirect'];
  const paidCounter = war.raise === 'token' || war.redirectToken;
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
      {standard && (
        <p className="text-muted">
          Hosts can choose how raising works (matched, for a token, free as in the original rules, or not at all), let
          redirects reach anywhere along the border or cost nothing, and switch fortifying, peace terms and calling off
          on or off. With peace terms off, tribute is an answer again.
        </p>
      )}
      <Part title="The attacker's reply">
        <p>A counter-offer goes back to the attacker, who has {RESPONSE_WINDOW_TEXT[war.pace]} to reply:</p>
        <Bullets>
          {war.raise !== 'off' && (
            <li>
              to a raise: <UI>Meet the raise</UI> with a stake of at least the amount demanded
              {war.raise === 'matched' ? ' (the stake as it was, plus the value of the country put in)' : ''},
              {backAndForth(rules) ? (
                <>
                  {' '}
                  <UI>Raise again</UI>, or <UI>Withdraw</UI>;
                </>
              ) : (
                <>
                  {' '}
                  or <UI>Withdraw</UI>;
                </>
              )}
            </li>
          )}
          <li>
            to a redirect: <UI>Fight for</UI> the offered country, or <UI>Withdraw</UI>
            {war.peaceTerms ? '.' : ';'}
          </li>
          {!war.peaceTerms && (
            <li>
              to a tribute offer: <UI>Accept tribute</UI>, or <UI>Refuse and fight</UI> as declared.
            </li>
          )}
        </Bullets>
        <p>
          With no reply, a {counters.join(' or ')} is withdrawn{war.peaceTerms ? '' : ' and a tribute is accepted'}.
          Withdrawing calls the war off: nothing changes hands, no truce follows, and the war token is spent
          {paidCounter ? ', along with any token the defender paid for the counter' : ''}.
        </p>
      </Part>
      {backAndForth(rules) && (
        <Part title="Raising back and forth" id="raising">
          <p>
            A war&apos;s stakes can be raised up to {war.raises} times, the defender&apos;s first raise included, each
            side in turn. Every raise is answered within {RESPONSE_WINDOW_TEXT[war.pace]}:
          </p>
          <Bullets>
            <li>
              the attacker raises again by staking at least {MATCHED_RAISE_MIN_PCT}% of the target&apos;s value more
              than the raise demands. Whatever they stake over it, up to the target&apos;s whole value and never more
              than the defender&apos;s most valuable free country, the defender must match;
            </li>
            <li>
              the defender answers with <UI>Meet the raise</UI>, putting in a country worth at least that much, with{' '}
              <UI>Raise again</UI>, putting in a country worth at least {MATCHED_RAISE_MIN_PCT}% of the target more
              (which the attacker must then add to the stake), or with <UI>Back down</UI>;
            </li>
            <li>once the last raise is made, the other side can only meet it or back down.</li>
          </Bullets>
          <p>
            Raising accepts the war. Whoever has raised and then backs down, or lets the time run out, loses the war as
            declared, without a game: a defender hands over the target, and keeps the countries they put in; an attacker
            hands over the stake as declared, and keeps what they added since. A truce follows as after a battle, but no
            mission counts a war won this way.
          </p>
        </Part>
      )}
      <Part title="Countries caught up in a war">
        <p>
          From the declaration until the war ends, the target, the stake
          {war.raise === 'matched'
            ? `, ${backAndForth(rules) ? 'countries raises put in' : 'a country a raise puts in'}`
            : ''}{' '}
          and any country offered as a redirect
          {war.peaceTerms ? '' : ' or tribute'} are tied up: nobody can attack them, stake them or offer them in another
          war.{reservesAllowed(rules) ? ' Reserves are tied up until the answer is settled.' : ''}
          {war.peaceTerms ? '' : ' Tokens offered as tribute are set aside until the attacker replies.'}
        </p>
      </Part>
      {war.peaceTerms && (
        <Part title="Peace terms" id="peace">
          <p>
            Either player can offer terms to end the war, from the declaration until its game is over, under Peace terms
            in the war&apos;s panel. Terms can hand over:
          </p>
          <Bullets>
            <li>from the attacker, any of the staked countries;</li>
            <li>
              from the defender, the target{war.raise === 'matched' ? ' (and a country a raise put in)' : ''}, or
              instead one country worth less than the target;
            </li>
            <li>
              war tokens, one way or the other: as many as the player paying holds (tokens received can take a player
              past {war.tokenCap});
            </li>
            <li>
              and an accord for {ACCORD_MIN_ROUNDS} to {ACCORD_MAX_ROUNDS} rounds, signed with the peace.
            </li>
          </Bullets>
          <p>
            Or nothing at all: a white peace. Only the two players ever see an offer. The other player accepts or turns
            it down within {answerTime(rules, standard)}, or it lapses; once the game is on, their next move turns it
            down, as a move does a draw offer. A new offer replaces your last one.
          </p>
          <p>
            Accepted, the war ends at once: the game stops (its moves are kept, with no result), the terms change hands,
            any accord comes into force, and a truce follows as after a war fought out. The terms become public then.
            Peace is neither a win nor a loss.
          </p>
        </Part>
      )}
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
      Blitz at {clock}: {liveClockText(clock)}. {war.turns ? 'Once everyone has finished declaring, the' : 'The'} board
      opens by itself after a short countdown. You play one live game at a time; any others wait their turn.
    </>
  );
  // An example worth reading: a mountain or island target with three of the attacker's countries on its border.
  const defenderEdge = HOME_TURF_PCT + TERRAIN_PCT;
  const attackerEdge = 3 * SUPPLY_LINE_PCT;
  const scale = (level: 'light' | 'full') =>
    `${HANDICAP_PCT_PER_100[level]}% more time (up to ${HANDICAP_CAP_PCT[level]}%)`;
  const handicapScale = standard
    ? `${scale('light')} with a light handicap, or ${scale('full')} with a full one`
    : scale(war.handicap === 'full' ? 'full' : 'light');
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
      <Part title="Rating handicap">
        {war.handicap === 'off' && !standard ? (
          <p>Off in this campaign: ratings don't change the clocks.</p>
        ) : (
          <>
            <p>
              {standard ? 'Hosts can give weaker players more time.' : 'Weaker players get more time.'} Each player's
              rating comes from their Lichess account (the rating for the campaign's kind of game, or the nearest kind
              they play), or a bot's level.{' '}
              {standard || war.selfRatings
                ? `${standard ? 'Hosts can also let players' : 'Players'} without an established Lichess rating give their own. `
                : 'Players without an established Lichess rating play unrated. '}
              Ratings are frozen when the draft starts, and a game with an unrated player has no handicap.
            </p>
            <p>
              For every 100 points between the two players, the weaker one gets {handicapScale}. In live games the
              stronger player has as much less; in correspondence they keep their time, so nobody's deadline lands in
              the middle of their night. Gaps under {HANDICAP_MIN_GAP} points don't count. The handicap comes on top of
              the clock modifiers, and the stake builder shows it before you declare.
            </p>
          </>
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
      <Part title="Over the board">
        <p>
          Meeting up? Either player can offer to play the game over the board, on a real board, and the game moves there
          once the other accepts. The clocks here stop where they are and no moves are made online; bring your own
          clock. When the game is over, report it: the winner says "I won", or either player reports a draw, and the
          other confirms it. Unanswered within {answerTime(rules, standard)}, a report stands. "I lost" ends the game at
          once. A disputed report leaves the game on the real board, and either player can take it back online when no
          report is waiting, with the clocks as they were. Bots play online only.
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
    [
      'Attacker wins',
      war.raise === 'matched'
        ? 'The attacker takes the target, and any country a raise put in.'
        : 'The attacker takes the target.',
    ],
    ['Defender wins', 'The defender takes the whole stake.'],
    ['Draw', draw],
    war.peaceTerms
      ? ['Peace', 'Whatever the terms name changes hands, and any accord they include comes into force.']
      : ['Tribute accepted', 'The country or tokens offered go to the attacker.'],
    ['Withdrawn', "Nothing changes hands, and the attacker's war token is spent."],
    ...(backAndForth(rules)
      ? [
          [
            'Backed down',
            'Whoever had raised and backed down loses the war as declared, without a game: the target, or the stake as declared. It counts for no mission as a war won.',
          ] as [string, string],
        ]
      : []),
  ];
  const settled = war.peaceTerms ? 'peace terms' : 'tribute';
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
            ? `Once a war is fought, ended by ${settled}${backAndForth(rules) ? ' or by one side backing down' : ''}, its two players can't declare war on each other ${forRounds(war.truceRounds)}. A withdrawn war brings no truce.`
            : 'There are no truces: the two players may declare war on each other again at once.'}
        </p>
      </Part>
      <Part title="Newly won countries">
        <p>
          {war.lockRounds > 0
            ? `A country won in a war or handed over by ${settled} can't be staked, or attacked from, ${forRounds(war.lockRounds)}. It can still be attacked.`
            : `Countries won in a war or handed over by ${settled} can be staked straight away.`}
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
          {rules.war.peaceTerms && (
            <>
              {' '}
              An accord can also come with <InlineLink href="#peace">peace terms</InlineLink>, signed the moment
              they&apos;re accepted.
            </>
          )}
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

function Bots() {
  return (
    <Section id="bots" title="Playing with bots">
      <p>
        In the lobby, the host can fill seats with bots and choose each one&apos;s chess level. A bot plays the whole
        game like anyone at the table: it drafts, chooses a secret mission, declares and answers wars, fortifies, makes
        and breaks accords, and plays its own games. It sees only what a player in its seat would see: no one
        else&apos;s secret mission until it&apos;s revealed, and no proposals or peace terms between other players.
      </p>
      <Part title="How fast">
        <p>
          Bots answer straight away. In a correspondence game a bot replies to your move within seconds, so you can play
          the whole game in one sitting; in a live game it takes a few seconds a move. A bot can play several games at
          once.
        </p>
      </Part>
      <Part title="Levels">
        <p>
          The level sets only how well a bot plays chess; every bot plays the map the same way. The host can change a
          level until the draft starts, and everyone sees each bot&apos;s level. Ratings are rough: the levels played
          one another, and the results are pinned to Stockfish&apos;s own calibration of level 3, which is measured
          against other engines. Take them as a guide rather than a match for your online rating.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-[0.95rem] leading-snug">
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="label py-1.5 pr-3">
                  Level
                </th>
                <th scope="col" className="label py-1.5 pr-3">
                  Rating
                </th>
                <th scope="col" className="label py-1.5">
                  Plays
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {BOT_LEVELS.map((l) => (
                <tr key={l.level} className="align-top">
                  <th scope="row" className="py-2 pr-3 font-semibold whitespace-nowrap">
                    {l.level} · {l.name}
                  </th>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">about {l.rating}</td>
                  <td className="py-2 text-muted">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Part>
      <Part title="Standing in for a player">
        <p>
          If a player goes quiet, the host can hand their empire to a bot, from the draft on: open the player&apos;s
          empire page (their name in the standings) and choose <UI>Hand to a bot</UI>. The bot plays the empire as its
          own, and everything stays the player&apos;s: countries, wars, accords, secret mission and points. Meanwhile
          the player can read everything and chat, and gets no notices the bot deals with. They take the empire back
          with <UI>Take it back</UI> whenever they return, and the host can hand it back too.
        </p>
      </Part>
      <Part title="Dealing with a bot">
        <p>
          Bots don&apos;t read messages. To deal with one, propose an accord or offer peace terms: it signs or accepts
          when that&apos;s worth more to it than war. Offered a draw, a bot takes it when a draw wins it the war,
          refuses when a draw loses it, and otherwise takes it unless it&apos;s doing better on the board.
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
  const { points, titles } = cfg;
  const titleNames = joinWords((titles?.kinds ?? []).map((k) => TITLES[k].name));
  const titlePts = titles ? `${titles.points} ${titles.points === 1 ? 'point' : 'points'}` : '';
  const hold = durationText(holdMs(rules));
  const holdOther = standard
    ? ` (${durationText(cfg.holdMinutes[rules.war.pace === 'live' ? 'correspondence' : 'live'] * 60_000)} in ${
        rules.war.pace === 'live' ? 'correspondence' : 'live'
      } campaigns)`
    : '';
  const chosen = rules.victory.publicMissions.map((m) => missionName(m));
  const defaults = cfg.defaultPublic.map((k) => kindName(k, cfg));
  const secretKinds = cfg.secretKinds.filter((k) => k !== 'measured_expansion');
  // Missions that are records, not positions: they score the moment they're done.
  const records = [...cfg.publicKinds, ...cfg.secretKinds]
    .filter((k) => MISSIONS[k].timing === 'historic')
    .map((k) => kindName(k, cfg));
  const last = lastRoundOf(rules);
  return (
    <Section id="ending" title="Winning">
      <p className="text-lg">
        The first to {points.toWin} victory points wins. Four public missions are worth {points.public} points each and
        every player has one secret mission worth {points.secret}
        {titles ? (
          <>
            , and {titles.kinds.length} titles are worth {titlePts} each to whoever leads the table on population, land,
            GDP and military might. Missions make {points.public * 4 + points.secret} points at most, so a winner holds
            a title or two as well.
          </>
        ) : (
          <>
            : two public missions and the secret make {points.public * 2 + points.secret}, and all four public ones make{' '}
            {points.public * 4}, so a player can win without their secret.
          </>
        )}
        {last !== null &&
          ` If nobody has ${points.toWin} when round ${last} ends, the campaign ends anyway, and the most points win, then ${tiebreakText(rules.victory.tiebreak)}.`}
        {standard && ' (The host can pick another last round, or none, in the lobby.)'}
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
              New campaigns play {joinWords(defaults)}. The host can pick any other four before the draft, or have four
              drawn at random
              {cfg.longDrawn < cfg.publicCount &&
                ` (at most ${cfg.longDrawn === 1 ? 'one' : cfg.longDrawn} of them marked Long campaign)`}
              , and draw new targets for them.
              {cfg.positionsNeedConquest &&
                ' Positions such as Strategic Positions count only once you have won one of their countries since the draft: the draft alone never scores them.'}
            </p>
            <MissionList kinds={cfg.publicKinds} cfg={cfg} />
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
          steps from done: conquests, or wins for the missions about battles), chooses one within{' '}
          {durationText(selectionMs(rules))}, and can't change it. Anyone still choosing when time runs out gets the
          best fit. Other players see only that you're ready.
        </p>
        {cfg.namedSets.every((t) => t.reveal >= t.need) ? (
          <p>
            A secret mission is revealed to everyone, with its exact targets, when you come within one step of it: for
            most missions, one conquest or one win away. Missions to hold named countries (seas and regions, mountains,
            straits and the Hidden Triangle) are revealed only once complete. Completing any mission always reveals it.
            Once revealed it stays public, even if you lose ground.
          </p>
        ) : (
          <p>
            A secret mission is revealed to everyone, with its exact targets, when you come within one step of it: for
            most missions, holding all but one target, or one conquest away. Completing it always reveals it. Once
            revealed it stays public, even if you lose ground.
          </p>
        )}
        <MissionList kinds={secretKinds} cfg={cfg} />
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
          {holdsByTurns(rules) ? (
            <li>
              every player has had their turns to declare war in a round since: declaring is over for that round,
              everyone having passed or run out of things to declare with (whoever has no war tokens and nothing to do
              is passed over). A host who starts the next round early can't cut this short: the claim waits for a round
              whose turns run their course;
            </li>
          ) : (
            <li>
              at least {hold}
              {holdOther} have passed since the next round started, so a host can't rush the rounds (the host can make
              this time longer in the lobby, never shorter);
            </li>
          )}
          <li>you have held it the whole time; and</li>
          <li>no war you're in could still break it. A war that can't touch it doesn't matter.</li>
        </Bullets>
        <p>
          Lose the position and the claim ends; complete it again and a new claim starts. Swapping which targets you
          hold doesn't end a claim, as long as the mission never stops being complete.{' '}
          {records.length === 1
            ? `${records[0]} is a record, not a position: it scores the moment it’s done.`
            : `${joinWords(records)} are records, not positions: they score the moment they’re done.`}
        </p>
      </Part>
      {titles && (
        <Part title="Titles">
          <p>
            {titleNames} are worth {titlePts} each. When round 1 starts, each goes to the player whose countries add up
            to the most people, the most land, the largest GDP, or the greatest military might. From then on a title
            moves the moment someone passes its holder, in a war, a peace or anything else that moves a country, and its
            points go with it: there is no claim and no waiting, so taking a title can win the campaign on the spot.
          </p>
          <p>
            A holder who is only matched keeps the title. If someone passes the holder level with another player, or
            several players share the lead when round 1 starts, nobody holds it until one of them leads alone.
          </p>
          <p>
            Military might counts each country&apos;s share of the world&apos;s military spending and its share of the
            world&apos;s armed forces, averaged, both by their square roots, so that no superpower owns it: an empire of
            middling armies can outrank one giant. The <UI>Missions</UI> tab shows who holds each title, their figure
            and yours, and each holder&apos;s name carries the title&apos;s token.
          </p>
        </Part>
      )}
      <Part title="Points and the finish">
        <p>
          {titles
            ? 'Mission points are never taken away: losing a country after a mission has scored costs nothing. Only titles change hands.'
            : 'Points are never taken away: losing a country after a mission has scored costs nothing.'}{' '}
          When several players reach {points.toWin} with the same change, the highest total wins, and equal totals share
          the victory.
        </p>
        <p>
          The campaign then ends and can no longer change: wars still underway are cancelled without a winner (their
          moves are kept), tokens held back as tribute or paid for a counter still unanswered go back, offers of peace
          lapse, and every secret mission is revealed in the final results.
        </p>
      </Part>
      <Part title="The last round">
        {last === null ? (
          <p>
            This campaign has no last round: it goes on until someone reaches {points.toWin}. The host sets one in the
            lobby, before the draft.
          </p>
        ) : (
          <p>
            Round {last} is the last{standard ? ' (the host can choose another, or none, in the lobby)' : ''}. When the
            host moves on from it, the campaign ends as if someone had won: the most victory points win.{' '}
            {rules.victory.tiebreak === 'value'
              ? 'Players level on points are separated by the most valuable empire, and players level on both share the victory.'
              : "Players level on points are separated by their empires' real-world size: the largest population wins; if that's level too, the most land area; then the largest GDP. Players level on all of it share the victory."}{' '}
            Claims still waiting to score don't count, so a position has to be complete by round {last - 2} to score in
            time.
          </p>
        )}
      </Part>
    </Section>
  );
}

const PLAYER_COUNTS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** Who a mission is for, where that depends on the size of the table. */
function tableTag(kind: MissionKind, cfg: MissionRules): string | null {
  const most = (cfg.maxPlayers as Partial<Record<MissionKind, number>>)[kind];
  if (most !== undefined) return `Up to ${PLAYER_COUNTS[most] ?? most} players`;
  const least =
    kind === 'iron_wall'
      ? cfg.ironWall.minPlayers
      : kind === 'protected_expansion'
        ? cfg.protectedExpansion.minPlayers
        : kind === 'nemesis'
          ? (cfg.nemesis.minPlayers ?? 0)
          : 0;
  return least > 2 ? `${PLAYER_COUNTS[least] ?? least} players or more` : null;
}

function MissionList({ kinds, cfg }: { kinds: readonly MissionKind[]; cfg: MissionRules }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {kinds.map((kind) => {
        const tags = [
          isLongMission(kind, cfg) && 'Long campaign',
          MISSIONS[kind].freeDraftOnly && 'Free drafts',
          tableTag(kind, cfg),
        ].filter((t): t is string => Boolean(t));
        return (
          <div key={kind} className="border-b border-line pb-2">
            <dt className="font-semibold">
              {kindName(kind, cfg)}
              {tags.map((tag) => (
                <span key={tag} className="ml-2 text-xs font-normal text-muted uppercase">
                  {tag}
                </span>
              ))}
            </dt>
            <dd className="text-[0.95rem] text-muted">{missionSummary(kind, cfg)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function Deadlines({ rules, standard }: { rules: CampaignRules; standard: boolean }) {
  const { war } = rules;
  const answer = RESPONSE_WINDOW_TEXT[war.pace];
  const rows: [who: string, time: string, silence: string][] = [
    ...(war.turns
      ? [
          [
            'A player takes their turn to declare',
            TURN_WINDOW_TEXT[war.pace],
            'They pass, and are done declaring for the round.',
          ] as [string, string, string],
        ]
      : []),
    ['The defender answers a declaration', answer, 'The war goes ahead as declared.'],
    [
      war.raise === 'off' ? 'The attacker replies to a redirect' : 'The attacker replies to a raise or redirect',
      answer,
      'The war is called off, and the token is spent.',
    ],
    ...(backAndForth(rules)
      ? [
          ['The defender answers the attacker’s raise', answer, 'They back down: the target goes to the attacker.'] as [
            string,
            string,
            string,
          ],
          [
            'The attacker answers a raise after raising',
            answer,
            'They back down: the stake as declared goes to the defender.',
          ] as [string, string, string],
        ]
      : []),
    war.peaceTerms
      ? ['A player answers peace terms', `${answer}, or before their next move in the game`, 'The offer lapses.']
      : ['The attacker replies to a tribute offer', answer, 'The tribute is accepted.'],
    ['A player answers an accord proposal', answer, 'The proposal lapses.'],
    ['A player moves', war.pace === 'live' ? 'Their clock' : perMoveText(war.hoursPerMove), 'They lose the game.'],
    ['A player answers a result reported over the board', answer, 'The result stands.'],
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
          `The times below are for correspondence campaigns; in live ones, ${war.turns ? 'turns and answers' : 'answers'} are due within ${RESPONSE_WINDOW_TEXT.live} and moves on the clock.`}
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
