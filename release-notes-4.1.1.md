# Sooskasse-FinTS 4.1.1

A safety and clarity release. When you move money, the safe choice is now the obvious one, and every outcome says what actually happened. Your privacy settings now do what they promise, and login works for more banks. Still true: no new bank operations, and everything is calculated on your machine.

## Safer transfers
- **Name check (Verification of Payee).** If the payee's name doesn't match the IBAN, the main button is now **"Angaben prüfen"**, which takes you back to the form with everything kept. "Trotzdem überweisen" is still there, as the secondary button. The result shows the checked IBAN and tells you how to confirm it with the payee. When no check was possible, the app says so instead of reporting a mismatch.
- **Duplicate warnings that stick.** "Schon einmal überwiesen?" and the overdraft warnings now come first on the review step and are read out by screen readers. Transfers from the last 14 days are kept, encrypted with your PIN, so the check also works after you log out. Pending bookings are checked too.
- **New overdraft warning.** If a transfer takes you into your overdraft (Dispo), the review says so before you approve it.
- **Refusals are reported as refusals.** If you tap "Ablehnen" in your banking app, or your bank refuses the order, the app now says **"Überweisung nicht ausgeführt"**, with the bank's reason. Before, it said the status was unclear. Anything the app can't be sure about is still reported as "Status unklar".
- **"Status unklar" can check for you.** "Jetzt nachsehen" reloads your bookings and pending entries and tells you whether the order has arrived, or asks you not to send it again. It never resends anything.
- **Compare before you approve.** The approval dialog now shows the amount, payee and full IBAN to compare with your banking app. Each kind of approval has its own title, and a second approval right after login is explained. If your bank's time limit runs out, the dialog says so and offers help.

## Privacy
- **Company logos are off until you agree.** The app asks once, before any company name leaves your machine, and the **"Firmenlogos"** switch in the session menu changes it later. Only company names are sent to the logo service Brandfetch, never amounts or IBANs. *If you already used logos, you'll be asked again.*
- **"Beträge ausblenden" hides more.** Amounts inside bank texts are now masked in the list and in booking details, and the balance chart no longer shows whether your account is below zero.
- **Clearer device memory.** The app tells you before it remembers your device, and the "Gerät gemerkt" notice links to "Gerät vergessen".

## Login
- **Find your bank more easily.** Search now accepts a BLZ with spaces or your IBAN. The IBAN stays on your machine; only the BLZ is used for the search. The DKB tile now leads to DKB.
- **Know what you need up front.** Before you enter your PIN, the app says you need app approval (e.g. S-pushTAN or SecureGo plus) and that chipTAN and smsTAN don't work here. "Was brauche ich?" explains the rest.
- **Plain messages when your bank has trouble.** Bank maintenance and timeouts get a plain German message instead of technical text. A slow login can be cancelled, and a locked online-banking login is recognised as such.

## Overview, transactions and analysis
- **Honest totals.** A failed fetch shows the bank's reason and "Erneut versuchen" for that account. The Gesamtsaldo only adds up once every balance is known, and "Alle Salden abrufen" fetches them.
- **Credit cards look like credit cards.** They show "Kartensaldo" and "Kreditrahmen", and a card balance is no longer shown in alarm red.
- **Find bookings by what you see.** Search finds the names, towns and categories shown in the list, and month names ("August"). Matching pending entries are pointed out, and a **month filter** narrows the list without fetching again.
- **Categories and analysis.** Choose a category first, then decide whether it applies to all bookings from that payee. "Automatisch" undoes a manual choice, and rules can be removed. Analyse keeps the month you picked. Cash withdrawals count as "Bargeld", not as a payment to your bank.
- **Contracts & subscriptions** names the accounts it is based on, separates housing from subscriptions, and says when an account couldn't be loaded.

## Printed statements and receipts
- **Redesigned Kontoauszug and Buchungsbeleg.** They have larger, readable type and page numbers, and they use the same terms as the app. A pending booking prints as "vorgemerkt", not "gebucht".
- *The document reference and checksum are now calculated over more of the printed details, so the same data gets a different reference than in 4.1.0.*

## Easier to use
- **Keyboard and screen readers.** The overview reads in the same order at every window width. Dialogs open on a safe button, and the booking list can be skipped with one key press.
- **Small windows and zoom.** Dialog buttons stay visible, and the transfer form and approval dialog fit the 900×600 minimum window and 200 % zoom.
- **Export.** CSV export now lives in the transaction list and saves what the list shows. The "gespeichert" confirmation appears only once the file is actually saved.
- **Logging out.** "Abmelden" is always visible in the session menu. Typing a short search like "ab" no longer logs you out by accident, and the app confirms that you've been logged out. If a transfer still has an unclear status, the app asks before logging you out.
- **Notices.** Error notices stay longer and pause while the window is in the background, and F6 jumps to them. While the automatic-logout warning is up, the taskbar button flashes.
