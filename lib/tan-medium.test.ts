import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Dialog, FinTSConfig, type BankingInformation } from 'lib-fints';
import { openWithPin, parseBox } from './crypto-box.ts';
import type { FinTSClientEx } from './fints-types';

// The device name (Bezeichnung des TAN-Mediums) an approval names. A bank
// like the Sparkasse checks it and refuses one it does not know with 9955
// "Die Gerätebezeichnung ist unbekannt": lib-fints sent the placeholder
// 'default' wherever the bank required a name and none was selected, and a
// remembered device kept naming a pushTAN app that had been set up again.

const BLZ = '54550010';
const USER = 'kunde9955';
const PIN = '24680';
const METHOD = 923;

/** NotAllowed 0, Optional 1, Required 2 (lib-fints TanMediaRequirement). */
function banking(requirement: number, listed: string[]): BankingInformation {
  return {
    systemId: 'SYS-9955',
    bankMessages: [],
    bpd: {
      version: 7, bankId: BLZ, bankName: 'Sparkasse Test', countryCode: 280, url: 'https://bank.test/fints',
      maxTransactionsPerMessage: 1, supportedLanguages: [], supportedHbciVersions: [300],
      availableTanMethodIds: [METHOD],
      supportedTanMethods: [{
        id: METHOD, name: 'pushTAN 2.0', version: 7, isDecoupled: true, activeTanMediaCount: listed.length,
        activeTanMedia: [...listed], tanMediaRequirement: requirement, tanMaxLength: 6, tanFormat: 'num',
        zkaMethod: 'Decoupled', zkaVersion: '1',
      }],
      allowedTransactions: [{ transId: 'HKCCS', tanRequired: true, versions: [1] }],
    },
  } as unknown as BankingInformation;
}

function config(requirement: number, listed: string[], name?: string): FinTSConfig {
  const cfg = FinTSConfig.fromBankingInformation('PRODUCT', '6.3', banking(requirement, listed), USER, PIN, METHOD);
  // As lib/session.ts restoredClient sets it: lib-fints' selectTanMedia throws for a name not listed.
  if (name) cfg.tanMediaName = name;
  return cfg;
}

type DialogInside = {
  getTanMediaName(): string | undefined;
  createCurrentCustomerMessage(): { segments: { header: { segId: string }; tanMedia?: string }[] };
};
const sent = (cfg: FinTSConfig) => (new Dialog(cfg, false) as unknown as DialogInside).getTanMediaName();

test('a required device name is never the placeholder: the one the bank lists, or none', () => {
  assert.equal(sent(config(2, [])), undefined, 'nothing known: none, never "default"');
  assert.equal(sent(config(2, ['iPhone von Manfred'])), 'iPhone von Manfred');
  assert.equal(sent(config(2, ['iPhone', 'SparkassenCard'])), undefined, 'several and none chosen: none');
});

test('a chosen device name goes out while the bank lists it or lists nothing', () => {
  assert.equal(sent(config(2, ['iPhone', 'SparkassenCard'], 'iPhone')), 'iPhone');
  assert.equal(sent(config(2, [], 'iPhone')), 'iPhone', 'no list read: the name stands');
  assert.equal(sent(config(1, ['iPhone'], 'iPhone')), 'iPhone');
  assert.equal(sent(config(1, [], 'iPhone')), 'iPhone');
});

test('a device name the bank no longer lists is not sent', () => {
  // The pushTAN app set up again: the bank's list (HKTAB) names the new one only.
  assert.equal(sent(config(2, ['Neues Handy'], 'Altes Handy')), 'Neues Handy');
  assert.equal(sent(config(2, ['Neues Handy', 'SparkassenCard'], 'Altes Handy')), undefined);
  assert.equal(sent(config(1, ['Neues Handy'], 'Altes Handy')), undefined, 'optional: left out');
  assert.equal(sent(config(1, [])), undefined);
});

test('a method that takes no device name sends none, whatever is selected', () => {
  assert.equal(sent(config(0, ['iPhone'], 'iPhone')), undefined);
  assert.equal(sent(config(0, [])), undefined);
});

test('the HKTAN on the wire carries no "default"', () => {
  const hktan = (cfg: FinTSConfig) => (new Dialog(cfg, false) as unknown as DialogInside)
    .createCurrentCustomerMessage().segments.find((seg) => seg.header.segId === 'HKTAN');
  assert.ok(hktan(config(2, [])), 'the dialog init asks with an HKTAN');
  assert.equal(hktan(config(2, []))?.tanMedia, undefined);
  assert.equal(hktan(config(2, ['iPhone']))?.tanMedia, 'iPhone');
});

test('a 9955 drops the name from the login and from the remembered device, which keeps its age', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-state-'));
  process.env.FINTS_STATE_DIR = dir;
  const store = await import('./state-store.ts');
  const { noteTanMediumAnswer, UNKNOWN_TAN_MEDIUM } = await import('./tan-media.ts');
  // As lib/session.ts restoredClient opens a remembered device (session.ts is server-only).
  const restoredClient = (saved: NonNullable<ReturnType<typeof store.loadProfile>>) => {
    const cfg = FinTSConfig.fromBankingInformation('PRODUCT', '6.3', saved.bankingInformation, USER, PIN, saved.tanMethodId);
    const m = cfg.selectedTanMethod;
    if (saved.tanMediaName && m) {
      m.activeTanMedia = Array.from(new Set([...(m.activeTanMedia || []), saved.tanMediaName]));
      cfg.tanMediaName = saved.tanMediaName;
    }
    return { config: cfg } as unknown as FinTSClientEx;
  };
  // Whichever test imported the store first set its folder.
  const stateDir = store.STATE_DIR;
  const remembered = () => store.loadProfile(BLZ, USER, PIN);
  const fileOf = () => {
    const files = fs.readdirSync(stateDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
    return path.join(stateDir, files[0]);
  };
  const savedAt = () => {
    const box = parseBox(JSON.parse(fs.readFileSync(fileOf(), 'utf8')));
    assert.ok(box);
    return (JSON.parse(openWithPin(PIN, box).toString('utf8')) as { savedAt: number }).savedAt;
  };
  try {
    const profile = { bankingInformation: banking(2, ['Altes Handy', 'SparkassenCard']), tanMethodId: METHOD, tanMediaName: 'Altes Handy' };
    assert.ok(store.saveProfile(BLZ, USER, PIN, profile));
    const before = savedAt();
    const session = () => ({
      client: restoredClient(remembered()!),
      meta: { blz: BLZ, bankName: 'Sparkasse Test', brand: 'generic', bic: null },
    }) as unknown as Parameters<typeof noteTanMediumAnswer>[0];

    // Another answer changes nothing.
    const s = session();
    noteTanMediumAnswer(s, new Set([9050, 9800]));
    assert.equal(s.client.config.tanMediaName, 'Altes Handy');
    assert.equal(remembered()?.tanMediaName, 'Altes Handy');

    noteTanMediumAnswer(s, new Set([9050, UNKNOWN_TAN_MEDIUM]));
    assert.equal(s.client.config.tanMediaName, undefined);
    assert.deepEqual(s.client.config.selectedTanMethod?.activeTanMedia, ['SparkassenCard']);
    assert.equal(sent(s.client.config), 'SparkassenCard', 'the one the bank still lists');
    const kept = remembered();
    assert.ok(kept);
    assert.equal(kept.tanMediaName, undefined);
    assert.deepEqual(kept.bankingInformation.bpd?.supportedTanMethods[0].activeTanMedia, ['SparkassenCard']);
    assert.equal(kept.tanMethodId, METHOD);
    assert.equal(savedAt(), before, 'no fresh login: the device keeps its age');

    // Opened again, the device names no gone device.
    assert.equal(session().client.config.tanMediaName, undefined);

    // Nothing to drop: the file is not written again.
    const mtime = fs.statSync(fileOf()).mtimeMs;
    noteTanMediumAnswer(session(), new Set([UNKNOWN_TAN_MEDIUM]));
    assert.equal(fs.statSync(fileOf()).mtimeMs, mtime);

    // A forgotten device is not remembered again by it.
    const again = restoredClient(remembered()!);
    again.config.tanMediaName = 'SparkassenCard';
    assert.ok(store.forgetProfile(BLZ, USER));
    noteTanMediumAnswer({ client: again, meta: { blz: BLZ } } as unknown as Parameters<typeof noteTanMediumAnswer>[0], new Set([UNKNOWN_TAN_MEDIUM]));
    assert.equal(again.config.tanMediaName, undefined);
    assert.equal(store.hasProfile(BLZ, USER), false);

    // Nor one another PIN made: it stays as it was.
    assert.ok(store.saveProfile(BLZ, USER, '11111', profile));
    assert.equal(store.dropTanMedium(BLZ, USER, PIN, 'Altes Handy'), false);
    assert.equal(store.loadProfile(BLZ, USER, '11111')?.tanMediaName, 'Altes Handy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
