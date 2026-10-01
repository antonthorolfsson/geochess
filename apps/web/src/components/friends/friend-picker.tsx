'use client';

import type { FriendView } from '@empire/rules';
import type { FriendGroup } from '@/lib/friends';

/**
 * Friends to invite, as checkboxes, with the players of the player's recent campaigns to pick in
 * one go. Friends in `exclude` (seated or invited already) are left out, groups included.
 */
export function FriendPicker({
  legend,
  friends: all,
  groups,
  selected,
  onChange,
  exclude = new Set(),
  disabled = false,
}: {
  legend: string;
  friends: readonly FriendView[];
  groups: readonly FriendGroup[];
  selected: readonly string[];
  onChange(userIds: string[]): void;
  exclude?: ReadonlySet<string>;
  disabled?: boolean;
}) {
  const open = (ids: readonly string[]) => ids.filter((id) => !exclude.has(id));
  const friends = all.filter((f) => !exclude.has(f.userId));
  const everyone = friends.map((f) => f.userId);
  const same = (ids: readonly string[]) => ids.length === selected.length && ids.every((id) => selected.includes(id));
  const toggle = (userId: string, on: boolean) =>
    onChange(on ? [...selected, userId] : selected.filter((id) => id !== userId));
  const choices = [
    ...groups.map((g) => ({ key: g.campaignId, label: g.name, ids: open(g.userIds) })),
    ...(everyone.length > 1 ? [{ key: 'everyone', label: 'Everyone', ids: everyone }] : []),
  ].filter((c) => c.ids.length > 0);

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="label mb-1">{legend}</legend>
      {choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Pick the players from</span>
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              className="btn btn-ghost btn-sm aria-pressed:border-paper aria-pressed:bg-raised/60"
              aria-pressed={same(c.ids)}
              onClick={() => onChange(c.ids)}
            >
              {c.label}
            </button>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="min-h-11 px-1 text-sm text-muted underline underline-offset-2 hover:text-paper"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          )}
        </div>
      )}
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-[3px] border border-line">
        {friends.map((f) => (
          <li key={f.userId}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1 hover:bg-raised/60">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-amber"
                checked={selected.includes(f.userId)}
                onChange={(e) => toggle(f.userId, e.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{f.name}</span>
                {f.lichessUsername && <span className="text-sm text-muted"> · {f.lichessUsername} on Lichess</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
