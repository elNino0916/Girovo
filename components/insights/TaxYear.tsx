'use client';

// The Steuer-Jahresübersicht in the Analyse: a tile that says what it is, and
// the drawer that puts it together (lib/tax-year.ts) — the year, the accounts,
// the categories, the sums as they stand, and the three ways out: the printed
// sheet (components/Statement.tsx), a CSV, and a ZIP of that CSV with the
// receipts kept on the bookings (lib/zip.ts).
//
// What is loaded decides what can be said. A year the loaded days do not
// cover is said to be incomplete, per account, its sums are minimums
// ("mind."), and each account offers to read the whole year — at the cost of
// an approval, which is why it is a button and never automatic.

import { useMemo, useState } from 'react';
import { allCategories, categoryLabel, type CategoryId } from '@/lib/categories';
import { saveFile, textBlob } from '@/lib/download';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import { fmtDate } from '@/lib/format';
import { msgs } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import {
  defaultTaxYear, taxBookings, taxFileName, taxLineText, taxYear, taxYearCsv, taxYears, type TaxYear,
} from '@/lib/tax-year';
import { uniqueNames, zipStore } from '@/lib/zip';
import { useFints, type ListedDoc } from '../FintsProvider';
import { CategoryIcon, ReceiptIcon } from '../icons';
import { Money } from '../Money';
import { trackUsage } from '../telemetry/usage';
import { Alert, Button, Checkbox, Drawer, Select } from '../ui';
import { InsightTile } from './shared';

/** The app's own categories a tax return usually asks about; the user's own ones are picked too. */
const DEFAULT_PICKS: readonly CategoryId[] = ['taxes', 'insurance', 'health'];

export function TaxYearTile() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <InsightTile
        title={t.tax.tile.title}
        actions={<Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t.tax.tile.open}</Button>}
      >
        <p className="px-4 pb-4 text-[14px] leading-snug text-ink-2 sm:px-6 sm:pb-5">{t.tax.tile.text}</p>
      </InsightTile>
      {open && <TaxYearDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

/** The accounts a summary can be made of: every one with Umsätze — a Depot has none. */
function summaryAccounts(accounts: readonly SerializedAccount[]): SerializedAccount[] {
  return accounts.filter((a) => a.canStatements !== false && a.accountType !== 'SecuritiesAccount');
}

function TaxYearDrawer({ onClose }: { onClose: () => void }) {
  const {
    accounts, txByAccount, statementInfo, categoryOf, accountLabel, loadRange, busy, printTaxYear, noteOf, receiptsOf,
    readDoc, toast,
  } = useFints();
  const t = useT();
  const words = t.tax.drawer;
  const today = useMemo(() => new Date(), []);
  const years = useMemo(() => taxYears(txByAccount, today), [txByAccount, today]);
  const [year, setYear] = useState(() => defaultTaxYear(years, today));
  const candidates = useMemo(() => summaryAccounts(accounts), [accounts]);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const inScope = candidates.filter((a) => !skipped.has(a.accountNumber));
  // Spending first, the side a return mostly asks about; the user's own ones close each side.
  const categories = useMemo(() => {
    const all = allCategories().filter((c) => !c.neutral);
    return [...all.filter((c) => c.direction !== 'in'), ...all.filter((c) => c.direction === 'in')];
  }, []);
  const [picked, setPicked] = useState<ReadonlySet<CategoryId>>(
    () => new Set([...DEFAULT_PICKS, ...categories.filter((c) => c.custom).map((c) => c.id)]),
  );
  const [zipping, setZipping] = useState(false);

  const spans = useMemo(() => {
    const out: Record<string, { from: string; to: string } | null> = {};
    for (const a of candidates) {
      const info = statementInfo[a.accountNumber];
      out[a.accountNumber] = info ? { from: info.from, to: info.to } : null;
    }
    return out;
  }, [candidates, statementInfo]);

  // Every category's figures for the year, so the list can say what each holds.
  const everything = useMemo(
    () => taxYear({ year, accounts: inScope, txsByAccount: txByAccount, spans, categoryOf, include: new Set(categories.map((c) => c.id)), today }),
    // inScope is derived from skipped and candidates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year, skipped, candidates, txByAccount, spans, categoryOf, categories, today],
  );
  const summary: TaxYear = useMemo(
    () => ({ ...everything, groups: everything.groups.filter((g) => picked.has(g.id)) }),
    [everything, picked],
  );
  const byId = useMemo(() => new Map(everything.groups.map((g) => [g.id, g])), [everything]);
  const coverageOf = useMemo(() => new Map(everything.accounts.map((a) => [a.accountNumber, a])), [everything]);
  const lineCount = summary.groups.reduce((n, g) => n + g.lines.length, 0);
  const bookings = useMemo(() => taxBookings(summary), [summary]);
  const receipts = useMemo(() => bookings.flatMap((tx) => receiptsOf(tx).map((doc) => ({ tx, doc }))), [bookings, receiptsOf]);
  const ready = picked.size > 0 && inScope.length > 0 && lineCount > 0;

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const accountOf = (n: string) => accounts.find((a) => a.accountNumber === n);

  /** The receipts' names in the ZIP: "2025-12-12 UNICEF Deutschland – Spende.pdf". */
  const receiptNames = (list: { tx: SerializedTransaction; doc: ListedDoc }[]) => uniqueNames(list.map(({ tx, doc }) => {
    const day = String(tx.entryDate || tx.valueDate).slice(0, 10);
    const who = taxLineText(tx).name.slice(0, 40);
    return [day, who, doc.name].filter(Boolean).join(' ');
  }));

  const saveCsv = async () => {
    const names = receiptNames(receipts);
    const nameOf = new Map(receipts.map((r, i) => [r.doc.id, names[i]]));
    const csv = taxYearCsv(summary, {
      accountOf,
      noteOf,
      receiptsOf: (tx) => receiptsOf(tx).map((d) => nameOf.get(d.id) ?? d.name),
    });
    try {
      const outcome = await saveFile(taxFileName(year, 'csv'), textBlob(csv, 'text/csv;charset=utf-8'));
      if (outcome === 'saved') {
        toast(words.savedCsv, 'success');
        trackUsage('export_created', { format: 'csv', kind: 'taxYear' });
      }
    } catch (e) {
      toast((e as Error).message || msgs().shell.csv.notSaved, 'error');
    }
  };

  const saveZip = async () => {
    setZipping(true);
    try {
      const names = receiptNames(receipts);
      const nameOf = new Map(receipts.map((r, i) => [r.doc.id, names[i]]));
      let files: { name: string; data: Uint8Array }[];
      try {
        files = await Promise.all(receipts.map(async ({ doc }, i) => ({
          name: names[i],
          data: new Uint8Array(await (await readDoc(doc)).arrayBuffer()),
        })));
      } catch {
        toast(words.zipFailed, 'error');
        return;
      }
      const csv = taxYearCsv(summary, { accountOf, noteOf, receiptsOf: (tx) => receiptsOf(tx).map((d) => nameOf.get(d.id) ?? d.name) });
      const zip = zipStore([{ name: taxFileName(year, 'csv'), data: new TextEncoder().encode(csv) }, ...files]);
      const outcome = await saveFile(taxFileName(year, 'zip'), new Blob([zip as BlobPart], { type: 'application/zip' }));
      if (outcome === 'saved') {
        toast(words.savedZip, 'success');
        trackUsage('export_created', { format: 'zip', kind: 'taxYear' });
      }
    } catch (e) {
      toast((e as Error).message || msgs().shell.csv.notSaved, 'error');
    } finally {
      setZipping(false);
    }
  };

  const yearRange = { from: `${year}-01-01`, to: `${year}-12-31` };

  return (
    <Drawer
      open
      onClose={onClose}
      title={words.title}
      width="lg"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={!ready} onClick={() => void saveCsv()}>{words.csv}</Button>
          <Button variant="secondary" disabled={!ready} busy={zipping} onClick={() => void saveZip()}>{words.zip}</Button>
          <Button variant="primary" disabled={!ready} onClick={() => { printTaxYear(summary); onClose(); }}>{words.pdf}</Button>
        </div>
      )}
    >
      <p className="text-[15px] leading-normal text-ink-2">{words.intro}</p>

      <div className="mt-5 max-w-[12rem]">
        <label htmlFor="tax-year" className="mb-1.5 block text-[13px] leading-snug font-semibold text-ink-2">{words.year}</label>
        <Select id="tax-year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </Select>
      </div>

      <section className="mt-6 border-t border-line pt-5" aria-labelledby="tax-accounts">
        <h3 id="tax-accounts" className="text-[15px] font-bold text-headline">{words.accounts}</h3>
        <ul className="mt-2">
          {candidates.map((a) => {
            const cov = coverageOf.get(a.accountNumber);
            const whole = cov?.coverage === 'complete' || cov?.coverage === 'running';
            const said = !cov || cov.coverage === 'none'
              ? words.coverage.none
              : cov.coverage === 'partial'
                ? words.coverage.partial(fmtDate(cov.from!), fmtDate(cov.to!))
                : words.coverage[cov.coverage];
            return (
              <li key={a.accountNumber} className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <Checkbox
                    checked={!skipped.has(a.accountNumber)}
                    onChange={() => setSkipped((s) => toggle(s, a.accountNumber))}
                    label={accountLabel(a)}
                    description={said}
                  />
                </div>
                {!whole && !skipped.has(a.accountNumber) && (
                  <Button
                    variant="tertiary"
                    size="xs"
                    className="-mr-2 shrink-0"
                    disabled={busy}
                    title={words.loadHint}
                    onClick={() => loadRange(a, yearRange)}
                  >
                    {words.load}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {!summary.complete && inScope.length > 0 && (
          <Alert tone="warn" className="mt-3">{words.incomplete(year)} {words.loadHint}</Alert>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5" aria-labelledby="tax-categories">
        <h3 id="tax-categories" className="text-[15px] font-bold text-headline">{words.categories}</h3>
        <ul className="mt-2">
          {categories.map((c, i) => {
            const g = byId.get(c.id);
            const side = c.direction === 'in' ? t.common.booking.incoming : t.common.booking.spending;
            const first = i === 0 || (categories[i - 1].direction === 'in') !== (c.direction === 'in');
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 border-b border-line py-2 last:border-b-0">
                {first && <p className="w-full pt-2 pb-1 text-[12.5px] font-semibold text-ink-3">{side}</p>}
                <span aria-hidden className="hidden size-8 shrink-0 place-items-center rounded-full bg-inset text-ink-2 sm:grid">
                  <CategoryIcon id={c.id} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <Checkbox
                    checked={picked.has(c.id)}
                    onChange={() => setPicked((s) => toggle(s, c.id))}
                    label={categoryLabel(c.id)}
                    description={g ? words.count(g.lines.length) : undefined}
                  />
                </div>
                {g && (
                  <span className="shrink-0 text-right text-[15px] font-semibold">
                    {!summary.complete && <span className="mr-1 text-[12.5px] font-normal text-ink-3">{words.atLeast}</span>}
                    <Money value={g.total} currency="EUR" signed tone="credit" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-5 space-y-3">
        {picked.size === 0 && <p className="text-[13.5px] font-semibold text-red">{words.pickOne}</p>}
        {inScope.length === 0 && <p className="text-[13.5px] font-semibold text-red">{words.noAccount}</p>}
        {picked.size > 0 && inScope.length > 0 && lineCount === 0 && <p className="text-[14px] text-ink-2">{words.empty(year)}</p>}
        {summary.otherCurrency > 0 && <Alert tone="info" className="">{words.otherCurrency(summary.otherCurrency)}</Alert>}
        {ready && (
          <p className="flex items-center gap-2 text-[13px] leading-snug text-ink-3">
            <ReceiptIcon size={16} className="shrink-0" />
            {words.zipHint(receipts.length)}
          </p>
        )}
        <p className="text-[13px] leading-snug text-ink-3">{words.disclaimer}</p>
      </div>
    </Drawer>
  );
}
