import type { DatasetIndex, TerritoryId } from '@empire/rules';
import { liveBots } from '@empire/sim/live';
import type { CampaignRow, MemberRow } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { draftState } from './state';

const bots = liveBots();

/**
 * A bot's draft pick: country value with a bonus for public mission targets and a little noise,
 * as the simulator's bots draft. Null with nothing left to claim.
 */
export function botDraftPick(
  ctx: AppContext,
  idx: DatasetIndex,
  campaign: CampaignRow,
  memberRows: readonly MemberRow[],
  owners: ReadonlyMap<TerritoryId, string>,
  botId: string,
): TerritoryId | null {
  const seed = Math.floor(ctx.random() * 2 ** 31);
  return bots.draftPick(draftState(idx, campaign, memberRows, owners, seed), botId);
}
