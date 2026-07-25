// Fetch the registered TAN-media names (Gerätebezeichnungen) via HKTAB.
//
// HKTAB is SCA-exempt, but only if the dialog init carries no HKTAN — so we
// run it with the TAN method temporarily deselected. Otherwise lib-fints adds
// an HKTAN with the placeholder media name 'default' and the bank rejects it
// (9955 "Gerätebezeichnung ist unbekannt").

import { Dialog } from 'lib-fints';
import { TanMediaInteraction } from './fints-internals.js';
import type { FinTSClientEx } from './fints-types';

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
