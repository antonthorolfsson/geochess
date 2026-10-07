'use client';

import {
  CORRESPONDENCE_HOURS,
  HANDICAP_CAP_PCT,
  HANDICAP_LEVELS,
  HANDICAP_PCT_PER_100,
  LIVE_CLOCKS,
  MATCHED_RAISE_MIN_PCT,
  MAX_PLAYERS,
  MAX_RAISES,
  MIN_PLAYERS,
  TURN_WINDOW_TEXT,
  type CampaignRules,
  type DraftMode,
  type DrawRule,
  type HandicapLevel,
  type Pace,
  type RaiseStyle,
  type WarRules,
  withStakeFloor,
} from '@empire/rules';
import { useId, type ReactNode } from 'react';
import { Toggle } from '../ui';

export const PACE_OPTIONS: { value: Pace; title: string; body: string }[] = [
  {
    value: 'correspondence',
    title: 'Correspondence',
    body: 'Games run over days, each move within the time per move. Suits campaigns that last weeks.',
  },
  {
    value: 'live',
    title: 'Live',
    body: 'Blitz for game nights with everyone online. Each player plays one game at a time.',
  },
];

const DRAFT_MODES: { value: DraftMode; title: string; body: string }[] = [
  {
    value: 'contiguous',
    title: 'Contiguous (recommended)',
    body: 'After your first pick, claim countries bordering your empire by land or sea lane, while any are left. Empires stay in one piece.',
  },
  {
    value: 'free',
    title: 'Free',
    body: 'Claim any free country on every pick. Expect scattered empires and long fronts.',
  },
];

const DRAW_OPTIONS: { value: DrawRule; title: string; body: string }[] = [
  { value: 'defender-holds', title: 'Defender holds', body: 'A drawn war changes nothing.' },
  {
    value: 'armageddon',
    title: 'Armageddon',
    body: 'A draw goes to one more game with colors swapped. Black gets four fifths of the time and wins a draw.',
  },
];

const handicapBody = (level: Exclude<HandicapLevel, 'off'>) =>
  `The weaker player gets ${HANDICAP_PCT_PER_100[level]}% more time for every 100 rating points between the two, up to ${HANDICAP_CAP_PCT[level]}%. In live games the stronger player has as much less.`;

const HANDICAP_OPTIONS: { value: HandicapLevel; title: string; body: string }[] = HANDICAP_LEVELS.map((value) =>
  value === 'off'
    ? { value, title: 'Off', body: 'Both players get the same time, whatever their ratings.' }
    : { value, title: value === 'full' ? 'Full' : 'Light', body: handicapBody(value) },
);

const hoursLabel = (h: number) => (h % 24 === 0 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} hours`);

/** How a defender raises the stakes, in the settings' words. */
export function raiseStyleOptions(rules: WarRules): { value: RaiseStyle; title: string; body: string }[] {
  return [
    {
      value: 'matched',
      title: 'Matched',
      body: `The defender puts one of their countries, worth ${MATCHED_RAISE_MIN_PCT}% to 100% of the target, into the war. The attacker adds at least as much to the stake or withdraws; winning takes both. With more than one raise, either side can raise again in turn.`,
    },
    {
      value: 'token',
      title: 'Costs a token',
      body: `The defender pays a war token to demand a stake of ${rules.raisePct}% of the target. The attacker gets the token for meeting it.`,
    },
    {
      value: 'free',
      title: 'Free (original)',
      body: `The defender demands a stake of ${rules.raisePct}% of the target at no cost.`,
    },
    {
      value: 'off',
      title: 'No raising',
      body: 'Defenders accept, redirect or talk peace. Try it with a higher stake floor.',
    },
  ];
}

/** A group of settings: a heading, a line on what it decides, and its controls in a box. */
export function SettingsGroup({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading} className="label">
        {title}
      </h2>
      {intro && <p className="mt-0.5 text-sm text-muted">{intro}</p>}
      <div className="mt-2 space-y-3 rounded-[3px] border border-line p-3 sm:p-4">{children}</div>
    </section>
  );
}

/** One of a few options, each with a title and a line on what it means. */
function Choices<T extends string>({
  legend,
  options,
  value,
  disabled,
  onChange,
}: {
  legend: string;
  options: { value: T; title: string; body: string }[];
  value: T;
  disabled: boolean;
  onChange(value: T): void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 font-semibold">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
          <input
            type="radio"
            name={name}
            className="mt-1 size-4 accent-amber"
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
          />
          <span>
            <span className="block font-semibold">{o.title}</span>
            <span className="block text-sm text-muted">{o.body}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A setting picked from a list, its label on the left. */
function SelectRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      {children}
    </label>
  );
}

interface FieldsProps {
  rules: CampaignRules;
  disabled: boolean;
  onSave(rules: Record<string, unknown>): void;
}

/** The table: how many can join, and how the draft deals out the map. */
export function TableFields({ rules, players, disabled, onSave }: FieldsProps & { players: number }) {
  return (
    <>
      <SelectRow label="Player limit">
        <select
          className="input w-24"
          value={rules.maxPlayers}
          disabled={disabled}
          onChange={(e) => onSave({ maxPlayers: Number(e.target.value) })}
        >
          {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
            <option key={n} value={n} disabled={n < players}>
              {n}
            </option>
          ))}
        </select>
      </SelectRow>
      <Choices
        legend="Draft"
        options={DRAFT_MODES}
        value={rules.draft.mode}
        disabled={disabled}
        onChange={(mode) => onSave({ draft: { mode } })}
      />
    </>
  );
}

/** The pace and the clocks: time control, turns, draws, clock modifiers and the rating handicap. */
export function ClockFields({ rules, disabled, onSave }: FieldsProps) {
  const war = rules.war;
  const save = (patch: Partial<WarRules>) => onSave({ war: patch });
  return (
    <>
      <Choices
        legend="Pace"
        options={PACE_OPTIONS}
        value={war.pace}
        disabled={disabled}
        onChange={(pace) => save({ pace })}
      />
      <SelectRow label="Time control">
        {war.pace === 'live' ? (
          <select
            className="input w-32"
            value={war.liveClock}
            disabled={disabled}
            onChange={(e) => save({ liveClock: e.target.value as WarRules['liveClock'] })}
          >
            {LIVE_CLOCKS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="input w-44"
            value={war.hoursPerMove}
            disabled={disabled}
            onChange={(e) => save({ hoursPerMove: Number(e.target.value) as WarRules['hoursPerMove'] })}
          >
            {CORRESPONDENCE_HOURS.map((h) => (
              <option key={h} value={h}>
                {hoursLabel(h)} per move
              </option>
            ))}
          </select>
        )}
      </SelectRow>
      <Toggle
        checked={war.turns}
        disabled={disabled}
        onChange={(turns) => save({ turns })}
        label="Take turns declaring"
        description={`Each round, players declare war or fortify one at a time, round the table, with ${TURN_WINDOW_TEXT[war.pace]} a turn; passing ends a player's declaring for the round. Off: anyone declares whenever they like, so the quickest get first pick.`}
      />
      <Choices
        legend="Draws"
        options={DRAW_OPTIONS}
        value={war.draws}
        disabled={disabled}
        onChange={(draws) => save({ draws })}
      />
      <Toggle
        checked={war.clockModifiers}
        disabled={disabled}
        onChange={(clockModifiers) => save({ clockModifiers })}
        label="Clock modifiers"
        description="Home turf, mountains and islands give the defender extra time; supply lines give the attacker extra time. Capped at 25%."
      />
      <Choices
        legend="Rating handicap"
        options={HANDICAP_OPTIONS}
        value={war.handicap}
        disabled={disabled}
        onChange={(handicap) => save({ handicap })}
      />
      {war.handicap !== 'off' && (
        <Toggle
          checked={war.selfRatings}
          disabled={disabled}
          onChange={(selfRatings) => save({ selfRatings })}
          label="Players give their own rating"
          description="Players without an established Lichess rating type one in. Off: they play unrated, and their games have no handicap."
        />
      )}
    </>
  );
}

/** How a war is answered: raising the stakes, redirects, fortifying, peace terms and calling off. */
export function AnswerFields({ rules, disabled, onSave }: FieldsProps) {
  const war = rules.war;
  const save = (patch: Partial<WarRules>) => onSave({ war: patch });
  return (
    <>
      <Choices
        legend="Raising the stakes"
        options={raiseStyleOptions(war)}
        value={war.raise}
        disabled={disabled}
        onChange={(raise) => save({ raise })}
      />
      {war.raise === 'matched' && (
        <div className="space-y-1">
          <SelectRow label="Raises in one war">
            <select
              className="input w-24"
              value={war.raises}
              disabled={disabled}
              onChange={(e) => save({ raises: Number(e.target.value) })}
            >
              {Array.from({ length: MAX_RAISES }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </SelectRow>
          <p className="text-sm text-muted">
            {war.raises === 1
              ? 'The defender raises once; the attacker meets it or withdraws (the original rule).'
              : `The attacker can raise again, then the defender, up to ${war.raises} raises in all. Whoever has raised and then backs down loses the war as declared, without a game: the defender the target, the attacker the stake.`}
          </p>
        </div>
      )}
      <Toggle
        checked={war.redirect === 'nearby'}
        disabled={disabled}
        onChange={(nearby) => save({ redirect: nearby ? 'nearby' : 'anywhere' })}
        label="Redirects stay nearby"
        description="A redirect must border the country attacked, and the war keeps that country's clock. Off: any same-value country bordering the attacker (the original rule)."
      />
      <Toggle
        checked={war.redirectToken}
        disabled={disabled}
        onChange={(redirectToken) => save({ redirectToken })}
        label="Redirects cost a token"
        description="The defender pays a war token to redirect; the attacker gets it for fighting on."
      />
      <Toggle
        checked={war.fortify}
        disabled={disabled}
        onChange={(fortify) => save({ fortify })}
        label="Fortifying"
        description={`A war token fortifies a country until the round after next: a war on it needs a stake of ${war.raisePct}% of its value.`}
      />
      <Toggle
        checked={war.peaceTerms}
        disabled={disabled}
        onChange={(peaceTerms) => save({ peaceTerms })}
        label="Peace terms"
        description="Either player can offer terms to end a war until its game is over: countries or tokens either way, or nothing, and an accord. Takes the place of tribute."
      />
      <Toggle
        checked={war.recall}
        disabled={disabled}
        onChange={(recall) => save({ recall })}
        label="Calling off"
        description="The attacker can call a declaration off until the defender answers. The token stays spent."
      />
    </>
  );
}

const NUMBERS: {
  key: 'tokensPerRound' | 'tokenCap' | 'truceRounds' | 'lockRounds';
  label: string;
  range: number[];
}[] = [
  { key: 'tokensPerRound', label: 'War tokens each round', range: [1, 2, 3] },
  { key: 'tokenCap', label: 'Most tokens a player can save up', range: [1, 2, 3, 4, 5] },
  { key: 'truceRounds', label: 'Rounds of truce after a war', range: [0, 1, 2, 3] },
  { key: 'lockRounds', label: 'Rounds before a won country can be staked', range: [0, 1, 2, 3, 4] },
];

const STAKES = [
  { key: 'stakeFloorPct', label: 'Least stake, as a share of the target', range: [80, 90, 100, 110, 125] },
  { key: 'raisePct', label: 'Stake a raise or a fortified country demands', range: [110, 125, 150, 175, 200] },
] as const;

/** The numbers: stakes, war tokens, truces and locks. */
export function NumberFields({ rules, disabled, onSave }: FieldsProps) {
  const war = rules.war;
  const save = (patch: Partial<WarRules>) => onSave({ war: patch });
  return (
    <>
      {STAKES.map(({ key, label, range }) => (
        <label key={key} className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-[0.95rem]">{label}</span>
          <select
            className="input w-24"
            value={war[key]}
            disabled={disabled}
            onChange={(e) => {
              const pct = Number(e.target.value);
              save(key === 'stakeFloorPct' ? withStakeFloor(war, pct) : { raisePct: pct });
            }}
          >
            {[...new Set([...range, war[key]])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
          </select>
        </label>
      ))}
      {NUMBERS.map(({ key, label, range }) => (
        <label key={key} className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-[0.95rem]">{label}</span>
          <select
            className="input w-20"
            value={war[key]}
            disabled={disabled}
            onChange={(e) => save({ [key]: Number(e.target.value) })}
          >
            {range.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ))}
    </>
  );
}
