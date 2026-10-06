// Step 2: select TAN method (+ media) and run the authenticated sync that
// pulls the account list (UPD). This usually triggers the decoupled approval.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { accountsFor, bankAnswerText, logResp, tanPayload } from '@/lib/serialize';
import { getSession, saveSessionProfile } from '@/lib/session';
import { fetchTanMediaNames } from '@/lib/tan-media';
import type { SelectTanResponse, TanMethod } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SelectTanBody = { sessionId: string; tanMethodId: number; tanMediaName?: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, tanMethodId, tanMediaName } = await body<SelectTanBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();

  // Only approval in the bank's app: the app has no field to type a TAN into.
  // Started with a typed-TAN method, the approval wait would fail a second
  // later with lib-fints' "TAN must be provided…" — and every retry again.
  const offered = (s.client.config.availableTanMethods || []).find((m) => m.id === Number(tanMethodId));
  if (!offered) return fail(msgs().auth.api.methodNotOffered);
  if (!offered.isDecoupled) return fail(msgs().auth.api.methodNeedsTan);

  const method = s.client.selectTanMethod(offered.id);

  // Banks with tanMediaRequirement=Required (e.g. Sparkasse pushTAN) need the
  // exact device name. Discover it via HKTAB, unless the caller already picked.
  if (tanMediaName) {
    method.activeTanMedia = Array.from(new Set([...(method.activeTanMedia || []), tanMediaName]));
    s.client.selectTanMedia(tanMediaName);
  } else if (method.tanMediaRequirement >= 2 && (!method.activeTanMedia || method.activeTanMedia.length === 0)) {
    // The bank wants a device name we don't have. Try to look it up via HKTAB…
    const names = await fetchTanMediaNames(s.client);
    console.log(`[select-tan] HKTAB media names: ${JSON.stringify(names)}`);
    if (names.length === 1) {
      method.activeTanMedia = names;
      s.client.selectTanMedia(names[0]);
    } else if (names.length > 1) {
      method.activeTanMedia = names;
      const choose: SelectTanResponse = { chooseTanMedia: names };
      return json(choose); // let the user pick
    } else {
      // …HKTAB isn't available here (Sparkasse rejects the list as non-PSD2).
      // Fall back to omitting the device name: with a single registered device
      // the bank uses it automatically. Downgrading Required→Optional makes
      // lib-fints send the HKTAN without the (still unknown) Bezeichnung.
      console.log('[select-tan] HKTAB unavailable — omitting device name (single-device fallback)');
      // 1 = TanMediaRequirement.Optional; lib-fints doesn't re-export the enum.
      method.tanMediaRequirement = 1 as TanMethod['tanMediaRequirement'];
    }
  }

  const sync = await s.client.synchronize();
  logResp('select-tan', s, sync);

  if (sync.requiresTan) {
    s.pending = { type: 'sync', tanReference: sync.tanReference };
    return json(tanPayload(sync));
  }
  if (!sync.success) {
    return fail(bankAnswerText(sync) || msgs().auth.api.loginFailed);
  }

  saveSessionProfile(s);
  const payload: SelectTanResponse = {
    needsTan: false,
    accounts: accountsFor(s),
    deviceSaved: s.deviceSaved || false,
  };
  return json(payload);
});
