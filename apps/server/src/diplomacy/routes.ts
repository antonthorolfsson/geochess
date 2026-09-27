import { ACCORD_MAX_ROUNDS, ACCORD_MIN_ROUNDS, FEED_FILTERS, MESSAGE_MAX } from '@empire/rules';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { answerAccord, proposeAccord, renounceAccord, withdrawAccord } from './accords';
import { ChatService } from './chat';

const id = z.string().min(1).max(40);
/** Player ids are letters, digits, dashes and underscores; conversation keys join two with a colon. */
const userId = z.string().regex(/^[\w-]{1,40}$/, 'Unknown player.');
const campaignParams = z.object({ id });
const accordParams = z.object({ id, accordId: id });
const messageParams = z.object({ id, messageId: z.coerce.number().int().positive() });

const proposeInput = z.object({
  partnerId: userId,
  rounds: z.number().int().min(ACCORD_MIN_ROUNDS).max(ACCORD_MAX_ROUNDS),
  // Trimmed and checked against the terms limit by the rules.
  terms: z.string().max(2000).nullish(),
});
const answerInput = z.object({ answer: z.enum(['accept', 'decline']) });

const sendInput = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(MESSAGE_MAX, `Messages can be at most ${MESSAGE_MAX} characters.`),
  to: userId.nullish(),
});
const feedQuery = z.object({
  filter: z.enum(FEED_FILTERS).default('all'),
  // Two ids, each well within a safe integer.
  before: z
    .string()
    .regex(/^\d{0,15}\.\d{0,15}$/, 'Unknown position in the feed.')
    .optional(),
});
const conversationQuery = z.object({ with: userId, before: z.coerce.number().int().positive().optional() });
const readInput = z.object({ with: userId.nullish(), lastId: z.number().int().nonnegative() });

export function registerDiplomacyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const chat = new ChatService(ctx);

  app.post('/api/campaigns/:id/accords', async (req, reply) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const input = parse(proposeInput, req.body);
    reply.code(201);
    return proposeAccord(ctx, params.id, user.id, input);
  });

  app.post('/api/campaigns/:id/accords/:accordId/answer', async (req) => {
    const user = requireUser(req);
    const params = parse(accordParams, req.params);
    const { answer } = parse(answerInput, req.body);
    await answerAccord(ctx, params.id, params.accordId, user.id, answer);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/accords/:accordId/withdraw', async (req) => {
    const user = requireUser(req);
    const params = parse(accordParams, req.params);
    await withdrawAccord(ctx, params.id, params.accordId, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/accords/:accordId/renounce', async (req) => {
    const user = requireUser(req);
    const params = parse(accordParams, req.params);
    await renounceAccord(ctx, params.id, params.accordId, user.id);
    return { ok: true };
  });

  app.get('/api/campaigns/:id/feed', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const query = parse(feedQuery, req.query);
    return chat.feed(params.id, user.id, query.filter, query.before);
  });

  app.get('/api/campaigns/:id/messages', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const query = parse(conversationQuery, req.query);
    return chat.conversation(params.id, user.id, query.with, query.before);
  });

  app.post('/api/campaigns/:id/messages', async (req, reply) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const input = parse(sendInput, req.body);
    reply.code(201);
    return chat.send(params.id, user.id, input);
  });

  app.delete('/api/campaigns/:id/messages/:messageId', async (req) => {
    const user = requireUser(req);
    const params = parse(messageParams, req.params);
    return chat.remove(params.id, params.messageId, user.id);
  });

  app.get('/api/campaigns/:id/chat', async (req) => {
    const user = requireUser(req);
    return chat.summary(parse(campaignParams, req.params).id, user.id);
  });

  app.post('/api/campaigns/:id/chat/read', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const input = parse(readInput, req.body);
    await chat.markRead(params.id, user.id, input.with ?? null, input.lastId);
    return { ok: true };
  });
}
