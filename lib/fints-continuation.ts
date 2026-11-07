// The rest of an approved answer.
//
// A bank that cannot fit an answer into one message sends the first part with
// return code 3040 and an Aufsetzpunkt, and the order goes out again with it
// for the next part. Without an approval lib-fints does that itself
// (Dialog.handlePartedMessages): an order message's own answer segments come
// back held aside, the same message goes out again with each Aufsetzpunkt,
// and every part ends up in the one answer the interaction reads.
//
// After an approval it does not. The approved answer comes back to the TAN
// message (HKTAN, process S or 2), which holds no order segment: lib-fints
// neither holds its parts aside nor has a segment to put the Aufsetzpunkt in.
// It read the first page as the whole answer and ended the dialog — a long
// date range fetched after an approval came back cut short.
//
// continuesAfterApproval gives an order interaction the step lib-fints leaves
// out. When an approved answer carries 3040, the interaction queues itself
// once more, right behind itself in the same dialog, with the Aufsetzpunkt:
// the next message is the very order message the no-approval path sends
// (HKTAN process 4 beside it where the bank wants one), and lib-fints'
// reassembly follows every page after that one. The pages before are carried
// along and put in front of the next answer's, so the interaction reads them
// all at once and in order, exactly as it reads a parted answer without an
// approval.
//
// A bank that wants another approval for the next page stops the dialog there
// as for any approval (app/api/tan-poll polls on), and the pages so far wait
// for it. A next page the bank refuses costs that page and those after it, no
// more: the pages there are delivered, as lib-fints does when a bank refuses a
// page without an approval.

import type { ClientResponse, FinTSConfig, Message, Segment } from 'lib-fints';
import type { CustomerOrderInteraction } from './fints-internals.js';

/** How many times the Aufsetzpunkt of an approved answer is followed, at most, before the answer stands as it is. */
export const MAX_APPROVAL_ROUNDS = 10;

// A mixin's base takes `any[]` arguments: TypeScript's rule for mixins.
type OrderClass = abstract new (...args: any[]) => CustomerOrderInteraction;

/** The Aufsetzpunkt of return code 3040, if the bank gave one. */
function markOf(response: Message): string | undefined {
  return response.getBankAnswers().find((a) => a.code === 3040)?.params?.find((p) => !!p?.trim())?.trim();
}

/** `pages` in front of the answer's own segments of `segId`. */
function putInFront(response: Message, segId: string, pages: readonly Segment[]): void {
  const at = response.segments.findIndex((s) => s.header.segId === segId);
  response.segments.splice(at < 0 ? response.segments.length : at, 0, ...pages);
}

/** `Base`, following the Aufsetzpunkt after an approval too (see the top of this file). */
export function continuesAfterApproval<T extends OrderClass>(Base: T) {
  abstract class ContinuesAfterApproval extends Base {
    /** The Aufsetzpunkt the next request carries. */
    #mark: string | undefined;
    /** The answer segments of the pages before. */
    #pages: Segment[] = [];
    #rounds = 0;
    /** Whether the message being answered is this order's own, not the TAN message that approved it. */
    #ownMessage = false;

    getSegments(config: FinTSConfig): Segment[] {
      const segments = super.getSegments(config);
      this.#ownMessage = true;
      if (this.#mark) {
        const own = segments.find((s) => s.header.segId === this.segId) as (Segment & { continuationMark?: string }) | undefined;
        if (own) own.continuationMark = this.#mark;
      }
      return segments;
    }

    handleClientResponse(response: Message): ClientResponse {
      // Only the TAN message's answer needs this: an order message's own answer
      // lib-fints has reassembled already, every page of it.
      const approved = !this.#ownMessage;
      this.#ownMessage = false;
      if (this.#pages.length) putInFront(response, this.responseSegId, this.#pages);
      const clientResponse = super.handleClientResponse(response);
      if (clientResponse.requiresTan) return clientResponse;
      if (!clientResponse.success) {
        if (!this.#pages.length) return clientResponse;
        // The next page refused: the pages there stand (see the top of this file).
        console.warn(`[pages] ${this.segId}: the next page refused after the approval, the pages before stand`);
        clientResponse.success = true;
        this.handleResponse(response, clientResponse);
        return clientResponse;
      }
      if (!approved || !response.hasReturnCode(3040)) return clientResponse;

      const mark = markOf(response);
      const dialog = this.dialog;
      const ends = clientResponse.bankAnswers.some((a) => a.code === 100 || a.code === 9000);
      if (!mark || !dialog || dialog.hasEnded || ends || this.#rounds >= MAX_APPROVAL_ROUNDS) {
        console.warn(`[pages] ${this.segId}: more to come after the approval, not followed (round ${this.#rounds + 1})`);
        return clientResponse;
      }
      this.#rounds++;
      this.#mark = mark;
      this.#pages = response.findAllSegments(this.responseSegId);
      console.log(`[pages] ${this.segId}: more to come after the approval, round ${this.#rounds + 1}`);
      // The same order once more, right after this answer: the dialog sends it as
      // the order message, and the answer it gets is this one's too (responses
      // keep the last answer per segment id).
      dialog.addCustomerInteraction(this, true);
      return clientResponse;
    }
  }
  return ContinuesAfterApproval;
}
