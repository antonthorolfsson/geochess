'use client';

import { joinWords, type CampaignRules, type CampaignView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api, errorMessage } from '@/lib/api';
import { keys } from '@/lib/queries';
import { changedSettings, standardRules } from '@/lib/rules-text';
import { Notice } from '../ui';
import { VictoryFields } from '../victory/lobby-missions';
import { useCampaignRoom } from './room-context';
import { AnswerFields, ClockFields, NumberFields, SettingsGroup, TableFields } from './settings-fields';

/**
 * Every host setting, on a page of its own over the campaign screen, so the map stays out of the
 * way: where an Advanced campaign starts, and where the lobby's "Change settings" leads. Each
 * change saves at once. Other players see the same page, read only; once the draft starts it
 * points to the rules, which list the settings in words.
 */
export function CampaignSettingsScreen() {
  const { model, showCountry } = useCampaignRoom();
  const { campaign, isHost } = model;
  const query = useSearchParams().toString();
  const lobbyHref = `/c/${campaign.id}${query ? `?${query}` : ''}`;
  const queryClient = useQueryClient();
  // The button that opened the page is now out of reach under it, so focus starts on the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  // Changes show at once and save in order; the campaign is read again once the last has landed.
  const save = useMutation({
    mutationKey: keys.settings(campaign.id),
    scope: { id: `settings-${campaign.id}` },
    mutationFn: (rules: Record<string, unknown>) => api.updateCampaign(campaign.id, { rules }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: keys.campaign(campaign.id) });
      queryClient.setQueryData<CampaignView>(
        keys.campaign(campaign.id),
        (old) => old && { ...old, rules: merged(old.rules, patch) },
      );
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: keys.settings(campaign.id) }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
      }
    },
  });

  const host = model.membersById.get(campaign.hostId)?.name ?? 'The host';
  const locked = campaign.status !== 'lobby';
  const editable = isHost && !locked;
  const changed = changedSettings(campaign.rules);
  const fields = {
    rules: campaign.rules,
    disabled: !editable,
    onSave: (patch: Record<string, unknown>) => save.mutate(patch),
  };

  // Missions and the mission rules version aren't settings the server takes this way.
  const resetToStandard = () => {
    if (!confirm('Put every setting back to the standard rules? The pace and the missions stay as they are.')) return;
    const standard = standardRules(campaign.rules);
    const { publicMissions: _missions, version: _version, ...victory } = standard.victory;
    save.mutate({
      maxPlayers: standard.maxPlayers,
      draft: standard.draft,
      war: standard.war,
      victory,
      rounds: standard.rounds,
    });
  };

  return (
    <article className="mx-auto max-w-2xl px-4 pt-5 lg:px-8">
      <header>
        <div className="label">Settings · {campaign.name}</div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-stencil text-[2rem] leading-tight tracking-wide focus:outline-none"
        >
          Campaign settings
        </h1>
        <p className="text-[0.95rem] text-muted">
          {locked
            ? 'The settings locked when the draft started.'
            : editable
              ? 'Choose how this campaign plays. Each change saves as you make it, and everything locks when the draft starts.'
              : `${host} chooses these, and can change them until the draft starts.`}
        </p>
      </header>

      {locked ? (
        <div className="mt-6 space-y-4 pb-10">
          <p className="text-[0.95rem]">
            The rules page lists every setting this campaign plays with, and explains each one.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/c/${campaign.id}/rules${query ? `?${query}` : ''}#settings`} className="btn btn-ghost">
              Rules
            </Link>
            <Link href={lobbyHref} className="btn btn-primary">
              Back to the map
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[3px] border border-line bg-raised/40 p-3">
            <p className="min-w-0 flex-1 text-[0.95rem]">
              {changed.length === 0 ? (
                <>
                  <strong>Standard rules.</strong> The settings a quick start plays with.
                </>
              ) : (
                <>
                  <strong>Changed from the standard rules:</strong> {joinWords(changed.map(lowerFirst))}.
                </>
              )}
            </p>
            {editable && changed.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={save.isPending}
                onClick={resetToStandard}
              >
                Use the standard rules
              </button>
            )}
          </div>

          <div className="mt-6 space-y-8">
            <SettingsGroup title="Players and draft" intro="How many can join, and how the map is shared out.">
              <TableFields {...fields} players={campaign.members.length} />
            </SettingsGroup>
            <SettingsGroup title="Pace and clocks" intro="How fast games are played, and who gets more time.">
              <ClockFields {...fields} />
            </SettingsGroup>
            <SettingsGroup title="Victory" intro="How the campaign is won, and when it ends.">
              <VictoryFields model={model} onSaveRules={fields.onSave} onSelectCountry={showCountry} />
            </SettingsGroup>
            <SettingsGroup
              title="Answering a war"
              intro="What a defender can do when war is declared on them, and what the attacker can do back."
            >
              <AnswerFields {...fields} />
            </SettingsGroup>
            <SettingsGroup title="Stakes, tokens and truces" intro="The numbers every war is fought with.">
              <NumberFields {...fields} />
            </SettingsGroup>
          </div>

          {/* Always in reach on a long page: what's happening to the changes, and the way back. */}
          <footer className="sticky bottom-0 mt-8 -mx-4 space-y-2 border-t border-line bg-gunmetal/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
            {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-muted" role="status">
                {save.isPending ? 'Saving…' : editable ? 'Changes save as you make them.' : ''}
              </p>
              <Link href={lobbyHref} className="btn btn-primary">
                Done
              </Link>
            </div>
          </footer>
        </>
      )}
    </article>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A partial change laid over the rules, as the server merges it, to show before it's saved. */
function merged(base: CampaignRules, patch: Record<string, unknown>): CampaignRules {
  return deepMerge(base, patch) as CampaignRules;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(base[key], value);
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
