'use client';

// "Weitere Bank anmelden": the login's own steps — the bank, Anmeldename and
// PIN, the Sicherheitsverfahren — in a sheet over the dashboard, for a session
// beside the first one (lib/linked-banks.ts, the provider's "more banks").
// The very components of the login screen, so a further bank is logged in to
// exactly like the first; the Freigabe is the usual approval overlay, which
// then names the bank. Closing the sheet calls the login off and leaves the
// dashboard as it was.

import { useT } from '@/lib/i18n/react';
import { BankPicker } from './auth/BankPicker';
import { Credentials } from './auth/Credentials';
import { useFints } from './FintsProvider';
import { TanMethodChoice } from './TanMethodPicker';
import { Overlay, Sheet } from './ui';

const STEP_NO = { bank: 1, credentials: 2, method: 3 } as const;

export function AddBankSheet() {
  const { addBank } = useFints();
  return addBank ? <AddBank /> : null;
}

function AddBank() {
  const {
    addBank: flow, popularBanks, logoFiles, meta, closeAddBank, pickAddBank, connectAddBank, cancelConnect,
    chooseAddBankMethod, clearAddBankMedia, addBankBack,
  } = useFints();
  const t = useT();
  if (!flow) return null;
  const { bank } = flow;

  return (
    <Overlay
      open
      onClose={closeAddBank}
      // A stray click beside the sheet must not throw away a typed PIN.
      onBackdrop={() => {}}
      label={t.banks.add}
    >
      <Sheet size="md" onClose={closeAddBank}>
        {/* The step's own title heads the sheet, a size below the login
            page's, where it heads the whole screen. */}
        <div className="[&_h1]:text-[24px]">
          <p className="pr-10 text-[13px] leading-snug font-semibold text-ink-3">{t.banks.step(STEP_NO[flow.step], 3)}</p>
          <div className="mt-2">
            {flow.step === 'bank' || !bank ? (
              <BankPicker banks={popularBanks} logoFiles={logoFiles} bankCount={meta?.bankCount} onPick={pickAddBank} />
            ) : flow.step === 'credentials' ? (
              <Credentials
                // As on the login screen: another bank is another form.
                key={bank.blz}
                bank={bank}
                logoFile={logoFiles[bank.brand]}
                meta={meta}
                initialLogin={flow.prefill?.blz === bank.blz ? flow.prefill.userId : undefined}
                // A login the view could not take (an account number already
                // shown) comes back here, saying why.
                initialError={flow.error}
                onChange={() => pickAddBank(null)}
                onSubmit={connectAddBank}
                onCancel={cancelConnect}
              />
            ) : (
              <TanMethodChoice
                bank={bank}
                tanMethods={flow.tanMethods}
                mediaChoice={flow.mediaChoice}
                selectedMethod={flow.selectedMethod}
                tanMethodError={flow.error}
                chooseTanMethod={chooseAddBankMethod}
                clearMediaChoice={clearAddBankMedia}
                onBack={addBankBack}
              />
            )}
          </div>
        </div>
      </Sheet>
    </Overlay>
  );
}
