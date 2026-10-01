import { readFileSync } from 'node:fs';
import type { CampaignSummary, CampaignView, FriendLinkPreview, FriendsView, InvitationView } from '@empire/rules';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, listen, signIn, startTestServer, tick, type Client, type TestServer } from './helpers';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

const OPEN = { victory: { mode: 'open' } };

async function lobby(host: Client, body: object = {}): Promise<string> {
  const res = await host.post<{ id: string }>('/api/campaigns', { name: 'Friendly Fire', ...body, rules: OPEN });
  expect(res.status).toBe(201);
  return res.body.id;
}

const view = async (c: Client, id: string) => (await c.get<CampaignView>(`/api/campaigns/${id}`)).body;
const friendsOf = async (c: Client) => (await c.get<FriendsView>('/api/friends')).body;
const friendNames = async (c: Client) => (await friendsOf(c)).friends.map((f) => f.name);
const invitations = async (c: Client) => (await c.get<InvitationView[]>('/api/invitations')).body;

async function joinByLink(c: Client, id: string, host: Client): Promise<void> {
  const { inviteCode } = await view(host, id);
  expect((await c.post(`/api/invites/${inviteCode}/join`)).status).toBe(200);
}

/** Makes `others` friends of `owner` through the owner's friend link. */
async function befriendByLink(owner: Client, ...others: Client[]): Promise<void> {
  const { friendCode } = await friendsOf(owner);
  for (const c of others) expect((await c.post(`/api/friend-links/${friendCode}`)).status).toBe(200);
}

describe('friends', () => {
  it('makes friends of everyone who drafts a campaign together, bots and leavers aside', async () => {
    const ann = await signIn(server.app, 'Ann Draft');
    const bo = await signIn(server.app, 'Bo Draft');
    const cy = await signIn(server.app, 'Cy Draft');
    const id = await lobby(ann);
    await joinByLink(bo, id, ann);
    await joinByLink(cy, id, ann);
    expect((await ann.post(`/api/campaigns/${id}/bots`, { level: 2 })).status).toBe(201);
    expect((await cy.post(`/api/campaigns/${id}/leave`)).status).toBe(200);
    // Sharing a lobby isn't enough: the table is settled when the draft starts.
    expect(await friendNames(ann)).toEqual([]);

    const sockets = [await listen(server.app, ann), await listen(server.app, bo)];
    expect((await ann.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    await server.bots();
    await tick();
    for (const s of sockets) {
      expect(s.messages).toContainEqual({ type: 'friends.changed' });
      s.close();
    }

    expect((await friendsOf(ann)).friends).toEqual([
      { userId: 'dev_bo-draft', name: 'Bo Draft', lichessUsername: null, campaignIds: [id] },
    ]);
    expect(await friendNames(bo)).toEqual(['Ann Draft']);
    expect(await friendNames(cy)).toEqual([]);
  });

  it('adds friends by link, both ways, and removes them for both', async () => {
    const di = await signIn(server.app, 'Di Link');
    const eve = await signIn(server.app, 'Eve Link');
    const { friendCode, friends } = await friendsOf(di);
    expect(friends).toEqual([]);
    expect((await friendsOf(di)).friendCode).toBe(friendCode);

    // Anyone with the link sees whose it is.
    const anon = await client(server.app).get<FriendLinkPreview>(`/api/friend-links/${friendCode}`);
    expect(anon.body).toEqual({ name: 'Di Link', self: false, friends: false });
    expect((await di.get<FriendLinkPreview>(`/api/friend-links/${friendCode}`)).body.self).toBe(true);
    expect((await client(server.app).post(`/api/friend-links/${friendCode}`)).status).toBe(401);
    const own = await di.post<{ error: { code: string } }>(`/api/friend-links/${friendCode}`);
    expect([own.status, own.body.error.code]).toEqual([400, 'own-link']);

    const socket = await listen(server.app, di);
    const added = await eve.post(`/api/friend-links/${friendCode}`);
    expect(added.body).toEqual({ userId: 'dev_di-link', name: 'Di Link' });
    await tick();
    expect(socket.messages).toContainEqual({ type: 'friends.changed' });
    socket.close();
    expect(await friendNames(di)).toEqual(['Eve Link']);
    expect((await friendsOf(eve)).friends).toEqual([
      { userId: 'dev_di-link', name: 'Di Link', lichessUsername: null, campaignIds: [] },
    ]);
    expect((await eve.get<FriendLinkPreview>(`/api/friend-links/${friendCode}`)).body.friends).toBe(true);
    // Opening it again changes nothing.
    expect((await eve.post(`/api/friend-links/${friendCode}`)).status).toBe(200);
    expect(await friendNames(di)).toEqual(['Eve Link']);

    const reset = await di.post<{ friendCode: string }>('/api/friends/link/reset');
    expect(reset.body.friendCode).not.toBe(friendCode);
    expect((await eve.get(`/api/friend-links/${friendCode}`)).status).toBe(404);
    expect((await friendsOf(di)).friendCode).toBe(reset.body.friendCode);

    expect((await eve.del('/api/friends/dev_di-link')).status).toBe(200);
    expect(await friendNames(di)).toEqual([]);
    expect(await friendNames(eve)).toEqual([]);
  });
});

describe('invitations', () => {
  it('invites friends to a new campaign, who join, decline or find it full', async () => {
    const [gus, hal, ida, jo, lee, kim] = await Promise.all(
      ['Gus', 'Hal', 'Ida', 'Jo', 'Lee', 'Kim'].map((n) => signIn(server.app, `${n} Invite`)),
    );
    await befriendByLink(gus!, hal!, ida!, jo!, lee!);
    const before = (await gus!.get<CampaignSummary[]>('/api/campaigns')).body.length;

    // Only friends can be invited, and a refusal creates nothing.
    const stranger = await gus!.post<{ error: { code: string } }>('/api/campaigns', {
      name: 'Too Wide',
      invite: ['dev_hal-invite', 'dev_kim-invite'],
    });
    expect([stranger.status, stranger.body.error.code]).toEqual([400, 'not-a-friend']);
    expect((await gus!.get<CampaignSummary[]>('/api/campaigns')).body.length).toBe(before);

    const socket = await listen(server.app, hal!);
    const sent = server.notices.length;
    const res = await gus!.post<{ id: string }>('/api/campaigns', {
      name: 'Old Friends',
      rules: { ...OPEN, maxPlayers: 3 },
      invite: ['dev_hal-invite', 'dev_ida-invite', 'dev_jo-invite', 'dev_lee-invite', 'dev_gus-invite'],
    });
    expect(res.status).toBe(201);
    const id = res.body.id;
    await tick();
    expect(socket.messages).toContainEqual({ type: 'friends.changed' });
    socket.close();
    expect(server.notices.slice(sent).map((n) => n.userId)).toEqual([
      'dev_hal-invite',
      'dev_ida-invite',
      'dev_jo-invite',
      'dev_lee-invite',
    ]);
    expect(server.notices.at(-1)).toMatchObject({
      title: 'Gus Invite invited you to Old Friends',
      url: '/',
      tag: `invitation-${id}`,
      email: true,
    });

    expect(await invitations(hal!)).toEqual([
      {
        campaignId: id,
        name: 'Old Friends',
        hostName: 'Gus Invite',
        invitedBy: { userId: 'dev_gus-invite', name: 'Gus Invite' },
        players: ['Gus Invite'],
        maxPlayers: 3,
        pace: 'correspondence',
        createdAt: expect.any(String),
      },
    ]);
    expect(await invitations(kim!)).toEqual([]);
    expect((await view(gus!, id)).invited).toEqual([
      { userId: 'dev_hal-invite', name: 'Hal Invite', invitedBy: 'dev_gus-invite' },
      { userId: 'dev_ida-invite', name: 'Ida Invite', invitedBy: 'dev_gus-invite' },
      { userId: 'dev_jo-invite', name: 'Jo Invite', invitedBy: 'dev_gus-invite' },
      { userId: 'dev_lee-invite', name: 'Lee Invite', invitedBy: 'dev_gus-invite' },
    ]);

    // Hal joins from the invitation, Jo from the invite link: either answers the invitation.
    expect((await hal!.post(`/api/invitations/${id}/join`)).body).toEqual({ id });
    expect(await invitations(hal!)).toEqual([]);
    await joinByLink(jo!, id, gus!);
    expect(await invitations(jo!)).toEqual([]);
    const v = await view(hal!, id);
    expect(v.members.map((m) => m.name)).toEqual(['Gus Invite', 'Hal Invite', 'Jo Invite']);
    expect(v.events.at(-1)).toMatchObject({ type: 'member.joined', payload: { name: 'Jo Invite' } });

    // The table is full: Lee's invitation stays, to decline.
    const full = await lee!.post<{ error: { code: string } }>(`/api/invitations/${id}/join`);
    expect([full.status, full.body.error.code]).toEqual([409, 'full']);
    expect((await invitations(lee!)).map((i) => i.players)).toEqual([['Gus Invite', 'Hal Invite', 'Jo Invite']]);

    expect((await ida!.post(`/api/invitations/${id}/decline`)).status).toBe(200);
    expect(await invitations(ida!)).toEqual([]);
    expect((await ida!.post(`/api/invitations/${id}/join`)).status).toBe(404);
    expect((await kim!.post(`/api/invitations/${id}/join`)).status).toBe(404);
    expect((await view(gus!, id)).invited.map((i) => i.name)).toEqual(['Lee Invite']);

    // The draft closes the rest, and the table is friends now.
    expect((await gus!.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    expect(await invitations(lee!)).toEqual([]);
    expect((await view(gus!, id)).invited).toEqual([]);
    expect(await friendNames(hal!)).toEqual(['Gus Invite', 'Jo Invite']);
    expect((await friendsOf(gus!)).friends.find((f) => f.name === 'Hal Invite')?.campaignIds).toEqual([id]);
    expect((await friendsOf(gus!)).friends.find((f) => f.name === 'Lee Invite')?.campaignIds).toEqual([]);
  });

  it('lets any member invite their own friends, and the inviter or host call it off', async () => {
    const [mo, ned, oz, pia] = await Promise.all(
      ['Mo', 'Ned', 'Oz', 'Pia'].map((n) => signIn(server.app, `${n} Lobby`)),
    );
    await befriendByLink(ned!, oz!);
    const id = await lobby(mo!);
    await joinByLink(ned!, id, mo!);
    await joinByLink(pia!, id, mo!);

    // Mo isn't Oz's friend; Oz isn't a member.
    expect((await mo!.post(`/api/campaigns/${id}/invitations`, { userIds: ['dev_oz-lobby'] })).status).toBe(400);
    expect((await oz!.post(`/api/campaigns/${id}/invitations`, { userIds: ['dev_ned-lobby'] })).status).toBe(404);

    const socket = await listen(server.app, oz!);
    const invited = await ned!.post(`/api/campaigns/${id}/invitations`, { userIds: ['dev_oz-lobby'] });
    expect(invited.body).toEqual({ invited: ['dev_oz-lobby'] });
    await tick();
    expect(socket.messages).toContainEqual({ type: 'friends.changed' });
    expect(server.notices.at(-1)).toMatchObject({
      userId: 'dev_oz-lobby',
      title: 'Ned Lobby invited you to Friendly Fire',
    });
    expect((await view(mo!, id)).invited).toEqual([
      { userId: 'dev_oz-lobby', name: 'Oz Lobby', invitedBy: 'dev_ned-lobby' },
    ]);
    // Again: nobody new is invited, and nobody is told twice.
    const notices = server.notices.length;
    expect((await ned!.post(`/api/campaigns/${id}/invitations`, { userIds: ['dev_oz-lobby'] })).body).toEqual({
      invited: [],
    });
    expect(server.notices.length).toBe(notices);

    expect((await pia!.del(`/api/campaigns/${id}/invitations/dev_oz-lobby`)).status).toBe(403);
    socket.messages.length = 0;
    expect((await mo!.del(`/api/campaigns/${id}/invitations/dev_oz-lobby`)).status).toBe(200);
    await tick();
    expect(socket.messages).toContainEqual({ type: 'friends.changed' });
    expect(await invitations(oz!)).toEqual([]);
    // Declining what's gone changes nothing, and members hear nothing of it.
    const members = await listen(server.app, mo!);
    expect((await oz!.post(`/api/invitations/${id}/decline`)).status).toBe(200);
    await tick();
    expect(members.messages.filter((m) => m.type !== 'hello')).toEqual([]);
    members.close();

    await ned!.post(`/api/campaigns/${id}/invitations`, { userIds: ['dev_oz-lobby'] });
    expect((await ned!.del(`/api/campaigns/${id}/invitations/dev_oz-lobby`)).status).toBe(200);
    expect((await view(mo!, id)).invited).toEqual([]);

    // Deleting the campaign takes its invitations with it.
    await ned!.post(`/api/campaigns/${id}/invitations`, { userIds: ['dev_oz-lobby'] });
    expect(await invitations(oz!)).toHaveLength(1);
    socket.messages.length = 0;
    expect((await mo!.del(`/api/campaigns/${id}`)).status).toBe(200);
    await tick();
    expect(socket.messages).toContainEqual({ type: 'friends.changed' });
    socket.close();
    expect(await invitations(oz!)).toEqual([]);
  });

  it('closes the invitations when the draft starts', async () => {
    const [qi, ray, sol] = await Promise.all(['Qi', 'Ray', 'Sol'].map((n) => signIn(server.app, `${n} Late`)));
    await befriendByLink(qi!, ray!, sol!);
    const id = await lobby(qi!, { invite: ['dev_ray-late'] });
    await ray!.post(`/api/invitations/${id}/join`);
    expect((await view(qi!, id)).invited).toEqual([]);
    expect((await qi!.post(`/api/campaigns/${id}/draft/start`)).status).toBe(200);
    const late = await qi!.post<{ error: { code: string } }>(`/api/campaigns/${id}/invitations`, {
      userIds: ['dev_sol-late'],
    });
    expect([late.status, late.body.error.code]).toEqual([409, 'not-in-lobby']);
  });
});

describe('the migration', () => {
  it('makes friends of everyone who had drafted a campaign together, bots aside', async () => {
    const own = await startTestServer();
    try {
      const [ann, bo, cy] = await Promise.all(['Ann', 'Bo', 'Cy'].map((n) => signIn(own.app, n)));
      const drafted = await lobby(ann!);
      await joinByLink(bo!, drafted, ann!);
      await ann!.post(`/api/campaigns/${drafted}/bots`, { level: 1 });
      await ann!.post(`/api/campaigns/${drafted}/draft/start`);
      await own.bots();
      const waiting = await lobby(ann!);
      await joinByLink(cy!, waiting, ann!);

      // As a database from before friends: none at all.
      await own.app.ctx.db.execute(sql`delete from friends`);
      const migration = readFileSync(new URL('../drizzle/0013_friends.sql', import.meta.url), 'utf8');
      const backfill = migration.split('--> statement-breakpoint').at(-1)!;
      await own.app.ctx.db.execute(sql.raw(backfill));

      const rows = await own.app.ctx.db.execute<{ user_id: string; friend_id: string }>(
        sql`select user_id, friend_id from friends order by user_id`,
      );
      expect(rows.rows.map((r) => [r.user_id, r.friend_id])).toEqual([
        ['dev_ann', 'dev_bo'],
        ['dev_bo', 'dev_ann'],
      ]);
    } finally {
      await own.close();
    }
  });
});
