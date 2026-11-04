---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["components/Dashboard.tsx"]
---

# Surface brief: the Girovo app (phone first)

Scope: the signed-in app on a phone (Android, below 640px): Übersicht, Zahlungen, Analyse, the search view, Einstellungen, and the sheets they open. Visitor mode: Operate. The desktop keeps its layout and gets the type changes for free; its own pass comes later (owner, 2026-10-23).

Audience and job: people who open their banking app several times a day to glance at the balance and the latest bookings, find one booking, or pay someone. Constraints: M3E components, Material You colours, Google Sans Flex (PRODUCT.md, Brand Commitments). Calm and precise.

Owner's answers (2026-10-23): the shipped look is generic, its hierarchy and density are weak, and its type and figures feel wrong. The first screen should be a compact balance with the bookings already visible, and the chart goes behind a tap. Navigation should have fewer, clearer places. Directions were shown before the build, then the whole app was built.

## Direction contract

THESIS: One field heads the home: it searches every booking, action and setting, and on Android answers a question about the bookings, so "Mehr" disappears into it. It refuses the category default of a big balance card over a short list with a floating button covering the amounts.

OWN-WORLD: Material You roles on a flat surface page. A 56dp search bar on surface-container-high is the only tinted shape at the top. The balance is set flat in Google Sans Flex 48/500 with tight tracking and 28px cents, Verfügbar in 14px on-surface-variant, and a small staircase sparkline beside it in the primary colour. There are three text sizes (12, 14, 16), one section step (18) and one screen step (22), plus display figures (48 for the balance, 32 to 36 for a lead figure). There is no positive tracking on figures. Headings come in two treatments: a section is 18/500 in ink, and a subheader is 14/500 in the variant ink. Einstellungen keeps its primary-colour subheaders (owner, 2026-10-20). (Amended after the finish review: the 18 step sits between 16px rows and 22px screen titles.) Rows lead with a 40dp category glyph disc. Name and amount are 16/500, the meta line is 14 on-surface-variant, and day headers are 14/500 in on-surface-variant. Credit is green, Vorgemerkt is an amber dot, and everything else is ink.

STORY: Someone opens the app, sees the balance and what is available, sees today's bookings without scrolling, and either taps a chip (Vorgemerkt, Eingänge, Ausgänge, the month) to narrow the list, taps the search to find anything, or goes to Zahlungen to pay.

FIRST VIEWPORT: Status bar. 8dp below it, the search bar, full width minus 16dp gutters, 56dp tall and fully rounded, holding a search glyph, "Umsätze suchen oder fragen", the Gemini spark (Android, when Nano can answer) and the 32dp avatar with the unread dot. 22dp below that, the account name with a chevron (the account menu) and, at the row's end, the eye that hides amounts ("Beträge ausblenden": screen sharing is a PRODUCT.md use, and it must stay one tap away on the home; amended after the finish review), then the 48px balance and the Verfügbar line, with a 96×36 sparkline in a 112×48 target, aligned right at the balance's baseline (a tap opens the details and the Kontoverlauf in place). 18dp below, one row of filter chips that scrolls sideways. Then day headers and rows down to the three-place navigation bar (Übersicht, Zahlungen, Analyse) at the foot. There is no FAB on the phone. The primary action, Überweisen, opens from the Zahlungen place and from the search.

FORM: Search-first home. Position 5 on my ranked list of six (category shapes, search-first, ledger with a running balance, month ruler, typographic figure, now-line timeline as ranked). Seed key 74866950, surface scope, Operate mode. Chosen comp: .impeccable/mocks/decision/b-suche.png (rendered from HTML, not generated).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- ~~The desktop's own pass (two panes, rail) follows later.~~ Done 2026-10-24 (Round 3).
- Whether the Kontoverlauf deserves more than a sheet behind the sparkline.

## Round 2 (owner, 2026-10-23): three more surfaces, each chosen from three dealt variants

Android only; the desktop is untouched. Icons are Material Symbols Rounded with the current place filled; the Analyse colours its categories in wallpaper tones; motion is the fade-through between places and the search view growing out of the search bar.

ÜBERWEISUNG, Betrag zuerst (seed 0232b423, dealt index 3, lead). THESIS: the transfer opens on the amount, typed into the figure itself at 64px and as large as the balance, with the number keyboard up; the recipient comes second. FIRST VIEWPORT: a close button and "Überweisung", a three-segment progress bar (Betrag · An wen? · Prüfen), the account field, the amount with Verfügbar under it, then Ausführung and Termin, and at the foot "Abbrechen" with "Weiter: An wen?". Part two holds the payee section and the Verwendungszweck. Prüfen is the existing review. All of the form's checks stay.

UMSATZDETAILS, Registerkarten (seed 8b9c4559, dealt index 4, lead). THESIS: a left-aligned header (the 56dp glyph disc, the 22px name, the bank's booking text and time, the 40px amount, the state tags, the actions) over Material's primary tabs: Details, Notiz & Belege, Kategorie. The Notiz & Belege tab carries a dot when something is attached.

ANMELDUNG, Markenfläche mit Blatt (seed 20ad6a35, dealt index 5). THESIS: the brand's primary-container field holds the G€ plate, "Girovo" and, on the first step, "Banking direkt mit deiner Bank – ohne jemanden dazwischen."; the steps rise over it as a 28px-cornered sheet. After the first step the field shrinks to the plate and the name. Quick picks are logo tiles, four by two: white tiles by day, the inset by night.

## Round 3 (owner, 2026-10-24): the desktop follows

The owner chose what the desktop (640px and up) takes from the phone: Material Symbols and the type, the tabbed Umsatzdetails and Betrag zuerst, the brand-field Anmeldung (as a left column with the sheet risen from the right); the plain-language Umsätze search stays Android only. For the Übersicht they asked for mocks first and picked "Suche oben" (decision page, `.impeccable/mocks/decision/desktop/b-suche-oben.png`, rendered from HTML; the unchosen a-zwei-spalten and c-konten-links beside it). Code-led: the comp is the finish review's reference.

ÜBERSICHT, Suche oben. THESIS: the phone's home at desktop scale. One search bar heads one column (880px in the mock, built at 960 so the chip row with the period, refresh and export fits on one line); the balance is flat with the account name as the way to the others and the eye at its row's end; a quiet line of month figures replaces the side pane; the chips (Vorgemerkt first) and about six bookings fill the first screen. RISK the owner accepted: wide margins, and other accounts, the Vormerkposten and the Mitteilungen are one click away; no Gesamtsaldo on the page (it is in the accounts sheet).

## Round 4 (owner, 2026-10-24): six additions to the Android app

Shaped with the owner: Sparziele live on the account (and in Analyse); Aufteilen splits equally by default with each share editable; Aufteilen and Sparziele are Plus perks in the Play build. Picked on the decision page from three rendered mocks each (`.impeccable/mocks/decision/r4/`): Freigabe-App öffnen B "Im Fuß, gefüllt"; Beleg fotografieren B "Ein Knopf mit Menü"; Aufteilen C "Anteile als Balken"; Sparziele C "Monatsplan" (built filled by the money, not by the months); Rechnung ohne GiroCode C "Rechnung daneben". Code-led: the comps are the finish review's reference. The accessibility pass (TalkBack, large text) followed an audit of the preview; DESIGN.md records the rules it set.

## Round 5 (owner, 2026-10-24): 5.14, the desktop takes 5.13's features

On the rebased desktop-follows-phone branch. Shaped with the owner: invoices on the desktop as PDFs (pdf.js) and photos (offline Tesseract); stand-ins for the phone-only parts are the approval app named in the wait and receipts by drop or paste; Aufteilen and Sparziele are free on the desktop. Picked on the decision page from three rendered mocks each (`.impeccable/mocks/decision/r5/`, 1440x900, approved sidecars): Aufteilen's requests "Alle nebeneinander" (d1-b: one wide Geld anfordern, a card per person), the invoice "Rechnung daneben" (d2-b: the page beside the form, the field in use lit). The build added a magnifier over the page ("Auf der Rechnung", the line of the field in use), because a real A4 page at the column's 444px sets its text at about 8px; the mock's half-empty page hid that.

## Round 6 (owner, 2026-11-04): the desktop shell, "Konten als Ebenen"

The owner said the Windows app reads as a big Android window and asked for mockups in Google's desktop Material 3 Expressive (answers: Google's desktop M3E, not Windows 11's Fluent; the desktop is used to glance and pay; every place plus Einstellungen). Three structures dealt on the decision page; the owner locked the lead. Mocks: `.impeccable/mocks/decision/desktop-shell/a-ebenen.png` (the chosen comp) and `.impeccable/mocks/desktop-shell/` (dark, one account, Zahlungen, Analyse, Einstellungen), rendered from HTML. Code-led, as Rounds 3 to 5: the comps are the finish review's critique reference.

## Direction contract: the desktop shell (Round 6)

THESIS: The desktop window is Google's desktop M3E, not the phone's rail scaled up: a tinted canvas holds a title bar and a labelled sidebar, the page is one white sheet beside them, and the accounts are layers ticked on and off like Calendar's calendars. It refuses the dashboard of balance cards and the phone's 96dp rail with 64px rows.

OWN-WORLD: Girovo's blue scheme and Google Sans Flex. Canvas surface-container-low (dark: lowest), the sheet surface-container-lowest (dark: low) with 16px corners, a 16px margin right and below. Title bar at the caption overlay's height: menu button, G€ plate, wordmark; a 44px search pill at the sheet's edge; bell, eye, Darstellung, avatar; Windows' caption buttons in the canvas tone. A 272px expanded rail: M3E's extended FAB "Überweisen" in primary container, M3E nav items lying horizontal as 40px pills, M3E's calendar as the month, M3E check boxes in each account's chart colour. Rows 48px at 14px, the balance 36px, the value colours unchanged.

STORY: Someone opens Girovo on their PC, sees what all their ticked accounts hold and every booking of them in one ledger, unticks the savings they do not want to see, picks one account to see it alone, and pays from the button that never moves.

FIRST VIEWPORT: Title bar across the window. Sidebar: Überweisen, Übersicht · Zahlungen · Analyse, the month (today outlined, payment days marked), "Konten" with each account's tick, name and balance, Einstellungen at the foot. Sheet: "Gesamtsaldo · 3 von 4 Konten", the 36px sum, what is hidden; the month's Eingänge, Ausgänge and Demnächst fällig at the right; the chips; then day headers and 48px rows, each with its account's colour dot and name before the amount.

FORM: Accounts as layers (Google Calendar's sidebar), position 3 of my seven grounded structures, dealt as the lead; seed key 6317aba8 (surface, operate). Signature move: ticking an account recomputes the ledger and the sum; one tick is that account's page.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
