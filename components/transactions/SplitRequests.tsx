'use client';

// Aufteilen's requests on the desktop (owner's pick "Alle nebeneinander",
// 2026-10-24): every person's GiroCode at once, where the phone opens Geld
// anfordern for one after the other. On a computer the codes go out as
// pictures into a chat or are scanned off the screen, so each person gets a
// card — their name, their share, their code, and the two ways to pass it on
// — and the user sees who is still to ask without stepping through dialogs.
//
// The codes are made here as Geld anfordern makes them (lib/girocode.ts,
// lib/qr.ts): the account the booking came from, its holder's name as the
// bank keeps it, the share and the purpose BillSplit settled. With "Beträge
// ausblenden" on they stay covered until asked for, as a code carrying an
// amount does in Geld anfordern.

import { useMemo, useRef, useState } from 'react';
import { buildEpcPayload } from '@/lib/girocode';
import { copyImage, copyText } from '@/lib/clipboard';
import { downloadBlob } from '@/lib/download';
import { fmtIban, initials, parseAmount } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { qrMatrix, qrPngBlob, qrSvgPath, type QrMatrix } from '@/lib/qr';
import { useFints } from '../FintsProvider';
import { CheckIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, ImageIcon } from '../icons';
import { Money, useMoneyText, usePrivacy } from '../Money';
import { shortIbanText } from '../transfer/model';
import { Panel } from '../transfer/Panel';
import { Button, IconButton, Overlay } from '../ui';

/** A person's colour, as their share's segment in BillSplit's bar. */
const tone = (index: number) => `var(--chart-${(index % 6) + 1})`;

type Card = {
  name: string;
  cents: number;
  code: { matrix: QrMatrix; path: { d: string; size: number } } | { error: string };
};

export function SplitRequests() {
  const { shareAll, closeShareAll, accounts, activeAccount, toast } = useFints();
  const t = useT();
  const words = t.transactions.billSplit.requests;
  const share = t.transfer.share;
  const money = useMoneyText();
  const privacy = usePrivacy();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [said, setSaid] = useState('');

  // The booking's own account when it can take money, else the first that can.
  const account = (activeAccount?.iban ? activeAccount : accounts.find((a) => !!a.iban)) ?? null;
  const holder = account?.holder ?? '';
  const purpose = shareAll?.people[0]?.purpose ?? '';

  const cards: Card[] = useMemo(() => (shareAll && account?.iban ? shareAll.people.map((p, i) => {
    const amount = p.amount ? parseAmount(p.amount) : null;
    const name = p.forName || t.transactions.billSplit.unnamed(i + 1);
    const cents = amount != null ? Math.round(amount * 100) : 0;
    try {
      const matrix = qrMatrix(buildEpcPayload({ name: holder, iban: account.iban!, bic: account.bic, amount, purpose: p.purpose ?? '' }));
      return { name, cents, code: { matrix, path: qrSvgPath(matrix) } };
    } catch (e) {
      return { name, cents, code: { error: (e as Error).message || share.codeFailed } };
    }
  }) : []), [shareAll, account?.iban, account?.bic, holder, t, share.codeFailed]);

  if (!shareAll || !account?.iban) return null;
  const currency = account.currency;
  const covered = privacy && !revealed;
  const n = shareAll.people.length + 1;

  const flash = (key: string, text: string) => {
    setCopied(key);
    setSaid(text);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1800);
  };
  const copyCode = async (card: Card, key: string) => {
    if (!('matrix' in card.code)) return;
    if (await copyImage(qrPngBlob(card.code.matrix, 8, 4, share.imageCaption))) flash(key, share.imageCopied);
    else toast(share.imageCopyFailed, 'error');
  };
  const saveCode = async (card: Card) => {
    if (!('matrix' in card.code)) return;
    try {
      const tail = account.iban!.replace(/\s+/g, '').slice(-6);
      const amt = `_${Math.floor(card.cents / 100)}-${String(card.cents % 100).padStart(2, '0')}`;
      // The person's name too, so three codes saved side by side are told apart.
      const who = card.name.normalize('NFKD').replace(/[^\w-]+/g, '').slice(0, 24);
      downloadBlob(`GiroCode_${tail}${amt}${who ? `_${who}` : ''}.png`, await qrPngBlob(card.code.matrix, 8, 4, share.imageCaption));
    } catch (e) {
      toast((e as Error).message || share.imageSaveFailed, 'error');
    }
  };
  const copyAccount = async () => {
    const text = [holder, `IBAN: ${fmtIban(account.iban!)}`, account.bic ? `BIC: ${account.bic}` : null].filter(Boolean).join('\n');
    if (await copyText(text)) flash('account', share.detailsCopied);
    else toast(share.copyFailed, 'error');
  };

  return (
    <Overlay open onClose={closeShareAll} labelledBy="split-requests-title" describedBy="split-requests-desc">
      <Panel
        size="xl"
        titleId="split-requests-title"
        title={share.title}
        eyebrow={words.eyebrow(shareAll.title, money(shareAll.total / 100, currency), n)}
        onClose={closeShareAll}
        bodyClassName="pt-0 pb-6"
        intro={(
          <p id="split-requests-desc" className="mb-5 text-[15px] leading-snug text-ink-2">
            {words.intro}{' '}
            {purpose && words.purpose(<span key="p" className="font-medium text-ink">{purpose}</span>)}
          </p>
        )}
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="min-w-fit text-[14px] leading-5 text-ink-2">
              {words.own(
                <Money key="o" value={shareAll.own / 100} currency={currency} tone="plain" className="font-medium text-ink" />,
                `${holder}, ${shortIbanText(account.iban)}`,
              )}
            </p>
            <div className="ml-auto flex flex-wrap gap-2 [&>*]:min-w-fit">
              <Button
                iconLeft={copied === 'account' ? <CheckIcon size={17} strokeWidth={2.2} /> : <CopyIcon size={17} />}
                onClick={() => void copyAccount()}
              >
                {copied === 'account' ? t.common.copied : share.copyDetails}
              </Button>
              <Button variant="primary" onClick={closeShareAll}>{words.done}</Button>
            </div>
            <span className="sr-only" aria-live="polite">{said}</span>
          </div>
        )}
      >
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, i) => {
            const key = `code-${i}`;
            return (
              <li key={key} className="flex min-w-0 flex-col items-center rounded-[20px] bg-paper p-5">
                <div className="flex w-full items-center gap-3">
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-full text-[15px] font-medium text-ink"
                    style={{ background: `color-mix(in srgb, ${tone(i)} 22%, var(--paper))` }}
                  >
                    {initials(card.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] leading-6 font-medium text-ink">{card.name}</p>
                    <p className="text-[14px] leading-5 text-ink-2">{t.transactions.billSplit.share}</p>
                  </div>
                  <Money value={card.cents / 100} currency={currency} tone="plain" className="text-[20px] leading-7 font-medium text-ink" />
                </div>

                <div className="mt-4">
                  {'error' in card.code ? (
                    <p className="grid size-[216px] place-items-center rounded-[16px] bg-inset px-5 text-center text-[14px] leading-5 text-ink-2">{card.code.error}</p>
                  ) : covered ? (
                    <div className="grid size-[216px] place-items-center rounded-[16px] bg-inset px-5 text-center">
                      <span className="flex flex-col items-center gap-2.5 text-[13.5px] leading-snug text-ink-2">
                        <EyeOffIcon size={28} className="text-ink-3" />
                        <Button size="sm" iconLeft={<EyeIcon size={16} />} onClick={() => setRevealed(true)}>{share.showCode}</Button>
                      </span>
                    </div>
                  ) : (
                    // White in both themes, black modules: a tinted code is one a scanner may refuse.
                    <div className="rounded-[16px] bg-white p-2 ring-1 ring-line">
                      <svg
                        viewBox={`0 0 ${card.code.path.size} ${card.code.path.size}`}
                        width="196"
                        height="196"
                        shapeRendering="crispEdges"
                        role="img"
                        aria-label={share.codeLabel(holder, money(card.cents / 100, currency))}
                        className="block"
                      >
                        <path d={card.code.path.d} fill="#000" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex w-full items-center gap-1">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={!('matrix' in card.code) || covered}
                    aria-label={words.copyFor(share.copyImage, card.name)}
                    iconLeft={copied === key ? <CheckIcon size={17} strokeWidth={2.2} /> : <ImageIcon size={17} />}
                    onClick={() => void copyCode(card, key)}
                  >
                    {copied === key ? t.common.copied : share.copyImage}
                  </Button>
                  <IconButton
                    size="md"
                    aria-label={words.copyFor(share.savePng, card.name)}
                    title={share.savePng}
                    disabled={!('matrix' in card.code) || covered}
                    onClick={() => void saveCode(card)}
                  >
                    <DownloadIcon size={20} />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </Overlay>
  );
}
