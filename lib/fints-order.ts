// Sending a money-moving order, and telling apart the two ways it can break.
//
// lib-fints sends an order in its own dialog: an init message, the order, a
// dialog end — each its own HTTP round trip. A connection that breaks during
// the init means nothing was sent; one that breaks once the init has gone
// through may have taken the order with it. The route handlers answer the
// first with an ordinary error (the transfer failed, try again) and the
// second with ORDER_UNANSWERED_STATUS, which the client shows as "Status
// unklar" — never as a failure, because a user told it failed sends it again.
//
// Type-only imports besides the texts, so the client can read the status
// constant from here without pulling the FinTS stack into its bundle.

import type { ClientResponseWithResult, FinTSClientEx } from './fints-types';
import type { CustomerOrderInteraction } from './fints-internals.js';
import { MESSAGES, msgs } from './i18n/index.ts';

/** The HTTP status for "the order went out, its answer did not come back". */
export const ORDER_UNANSWERED_STATUS = 502;

/**
 * @deprecated The German sentence, for code that compares. An OrderUnanswered
 * carries msgs().provider.bank.orderUnanswered, in the language of the request.
 */
export const ORDER_UNANSWERED_MESSAGE = MESSAGES.de.provider.bank.orderUnanswered;

/** The order may have reached the bank; its answer never arrived. */
export class OrderUnanswered extends Error {
  constructor(cause: unknown) {
    super(msgs().provider.bank.orderUnanswered, { cause });
    this.name = 'OrderUnanswered';
  }
}

/**
 * The members of lib-fints' running dialog read here. Runtime fields the
 * published declarations do not expose (fints-types.ts widens the client the
 * same way).
 */
type DialogView = {
  isInitialized?: boolean;
  responses?: Map<string, ClientResponseWithResult>;
  currentInteraction?: { segId?: string };
};

/** lib-fints' own dialog-end segment, the last interaction of every dialog. */
const DIALOG_END = 'HKEND';

/**
 * `client.startCustomerOrderInteraction(interaction)`, with its failures
 * sorted:
 *  - the order was answered and only the dialog end broke → that answer, as
 *    if nothing had happened (the bank has the order and said so);
 *  - the dialog was open when it broke → OrderUnanswered;
 *  - it broke before → the original error: nothing went out.
 */
export async function startOrder(
  client: Pick<FinTSClientEx, 'startCustomerOrderInteraction' | 'currentDialog'>,
  interaction: CustomerOrderInteraction,
): Promise<ClientResponseWithResult> {
  const before = client.currentDialog;
  try {
    return await client.startCustomerOrderInteraction(interaction);
  } catch (err) {
    const d = client.currentDialog as DialogView | undefined;
    // No dialog of this order's own: it failed before anything was built.
    if (!d || d === (before as unknown)) throw err;
    if (d.currentInteraction?.segId === DIALOG_END) {
      const answer = d.responses?.get(interaction.segId);
      if (answer) return answer;
    }
    if (d.isInitialized) throw new OrderUnanswered(err);
    throw err;
  }
}
