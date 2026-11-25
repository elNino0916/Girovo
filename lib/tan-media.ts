// Fetch the registered TAN-media names (Gerätebezeichnungen) via HKTAB, and
// drop a name the bank says it does not know (noteTanMediumAnswer).
//
// HKTAB is SCA-exempt, but only if the dialog init carries no HKTAN — so we
// run it with the TAN method temporarily deselected. Otherwise lib-fints adds
// an HKTAN to the init, and the bank rejected one naming a device it does not
// know (9955 "Gerätebezeichnung ist unbekannt").

import { Dialog } from 'lib-fints';
import { TanMediaInteraction } from './fints-internals.js';
import type { FinTSClientEx } from './fints-types';
import type { Session } from './session';
import { dropTanMedium } from './state-store.ts';

export async function fetchTanMediaNames(client: FinTSClientEx): Promise<string[]> {
  const cfg = client.config;
  const savedMethodId = cfg.tanMethodId;
  const savedMediaName = cfg.tanMediaName;
  try {
    cfg.tanMethodId = undefined;
    cfg.tanMediaName = undefined;
    const dialog = new Dialog(cfg, false);
    dialog.addCustomerInteraction(new TanMediaInteraction());
    const responses = await dialog.start();
    const resp = responses.get('HKTAB') as { tanMediaList?: string[] } | undefined;
    return resp?.tanMediaList ? resp.tanMediaList : [];
  } finally {
    cfg.tanMethodId = savedMethodId;
    cfg.tanMediaName = savedMediaName;
  }
}

/** FinTS 9955: the bank does not know the TAN medium an approval named ("Die Gerätebezeichnung ist unbekannt"). */
export const UNKNOWN_TAN_MEDIUM = 9955;

/**
 * The bank's answer to a call in the session (its codes): where it did not
 * know the device name sent with the approval (9955), say after the pushTAN
 * app was set up again under another name, that name goes, from this login
 * and from the device remembered for it. The next approval names the one
 * device the bank lists, or none (lib-fints Dialog.getTanMediaName, patched).
 * Nothing is sent again here.
 */
export function noteTanMediumAnswer(s: Pick<Session, 'client' | 'meta'>, codes: ReadonlySet<number>): void {
  const cfg = s.client?.config;
  const name = cfg?.tanMediaName;
  if (!codes.has(UNKNOWN_TAN_MEDIUM) || !cfg || !name) return;
  cfg.tanMediaName = undefined;
  for (const method of cfg.bankingInformation?.bpd?.supportedTanMethods ?? []) {
    if (method.activeTanMedia?.includes(name)) method.activeTanMedia = method.activeTanMedia.filter((n) => n !== name);
  }
  const kept = !!s.meta?.blz && !!cfg.userId && !!cfg.pin && dropTanMedium(s.meta.blz, cfg.userId, cfg.pin, name);
  console.log(`[tan-media] the bank does not know the device name sent (9955): dropped${kept ? ', also from the remembered device' : ''}`);
}
