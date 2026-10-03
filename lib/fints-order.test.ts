import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrderUnanswered, startOrder } from './fints-order.ts';

// A stand-in for lib-fints' client: startCustomerOrderInteraction opens a new
// dialog, walks it as far as `stopAt` allows and then throws like a broken
// connection would — the way Dialog.start() does.
type Step = 'init' | 'order' | 'end';

function fakeClient(stopAt: Step | null, opts: { failBeforeDialog?: boolean } = {}) {
  const orderAnswer = { success: true, requiresTan: false, bankAnswers: [{ code: 20, text: 'Auftrag ausgeführt.' }] };
  const client = {
    currentDialog: { hasEnded: true } as Record<string, unknown> | undefined,
    async startCustomerOrderInteraction(interaction: { segId: string }) {
      if (opts.failBeforeDialog) throw new Error('fetch failed');
      const responses = new Map<string, unknown>();
      const dialog: Record<string, unknown> = {
        hasEnded: false, isInitialized: false, responses, currentInteraction: { segId: 'HKIDN' },
      };
      client.currentDialog = dialog;
      if (stopAt === 'init') throw new Error('fetch failed');
      dialog.isInitialized = true;
      dialog.currentInteraction = interaction;
      if (stopAt === 'order') throw new Error('ECONNRESET');
      responses.set(interaction.segId, orderAnswer);
      dialog.currentInteraction = { segId: 'HKEND' };
      if (stopAt === 'end') throw new Error('ETIMEDOUT');
      return orderAnswer;
    },
  };
  return { client, orderAnswer };
}

const order = { segId: 'HKCCS' } as unknown as Parameters<typeof startOrder>[1];
const run = (c: ReturnType<typeof fakeClient>['client']) => startOrder(c as unknown as Parameters<typeof startOrder>[0], order);

test('a clean run hands back the order\'s answer', async () => {
  const { client, orderAnswer } = fakeClient(null);
  assert.equal(await run(client), orderAnswer);
});

test('broken before the dialog was open: the original error, nothing went out', async () => {
  await assert.rejects(run(fakeClient('init').client), (e: Error) => !(e instanceof OrderUnanswered) && e.message === 'fetch failed');
  await assert.rejects(run(fakeClient(null, { failBeforeDialog: true }).client), (e: Error) => !(e instanceof OrderUnanswered));
});

test('broken while the order was on its way: unanswered, not failed', async () => {
  await assert.rejects(run(fakeClient('order').client), (e: Error) => e instanceof OrderUnanswered);
});

test('only the dialog end broke: the bank\'s answer to the order stands', async () => {
  const { client, orderAnswer } = fakeClient('end');
  assert.equal(await run(client), orderAnswer);
});
