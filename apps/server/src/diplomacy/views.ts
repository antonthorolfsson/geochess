import type { AccordView, MessageView } from '@empire/rules';
import type { accords, messages } from '../db/schema';

export type AccordRow = typeof accords.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export function toAccordView(row: AccordRow): AccordView {
  return {
    id: row.id,
    proposerId: row.proposerId,
    recipientId: row.recipientId,
    status: row.status,
    rounds: row.rounds,
    terms: row.terms,
    proposedRound: row.proposedRound,
    proposedAt: row.proposedAt.toISOString(),
    respondBy: row.respondBy?.toISOString() ?? null,
    signedRound: row.signedRound,
    signedAt: row.signedAt?.toISOString() ?? null,
    endsRound: row.endsRound,
    endedRound: row.endedRound,
    endedAt: row.endedAt?.toISOString() ?? null,
    brokenBy: row.brokenBy,
    renews: row.renews,
  };
}

export function toMessageView(row: MessageRow): MessageView {
  return {
    id: row.id,
    authorId: row.authorId,
    recipientId: row.recipientId,
    body: row.removedAt ? null : row.body,
    removed: row.removedAt ? (row.removedBy === row.authorId ? 'author' : 'host') : null,
    createdAt: row.createdAt.toISOString(),
  };
}
