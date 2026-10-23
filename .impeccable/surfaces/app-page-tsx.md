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

- The desktop's own pass (two panes, rail) follows later.
- Whether the Kontoverlauf deserves more than a sheet behind the sparkline.

## Round 2 (owner, 2026-10-23): three more surfaces, each chosen from three dealt variants

Android only; the desktop is untouched. Icons are Material Symbols Rounded with the current place filled; the Analyse colours its categories in wallpaper tones; motion is the fade-through between places and the search view growing out of the search bar.

ÜBERWEISUNG, Betrag zuerst (seed 0232b423, dealt index 3, lead). THESIS: the transfer opens on the amount, typed into the figure itself at 64px and as large as the balance, with the number keyboard up; the recipient comes second. FIRST VIEWPORT: a close button and "Überweisung", a three-segment progress bar (Betrag · An wen? · Prüfen), the account field, the amount with Verfügbar under it, then Ausführung and Termin, and at the foot "Abbrechen" with "Weiter: An wen?". Part two holds the payee section and the Verwendungszweck. Prüfen is the existing review. All of the form's checks stay.

UMSATZDETAILS, Registerkarten (seed 8b9c4559, dealt index 4, lead). THESIS: a left-aligned header (the 56dp glyph disc, the 22px name, the bank's booking text and time, the 40px amount, the state tags, the actions) over Material's primary tabs: Details, Notiz & Belege, Kategorie. The Notiz & Belege tab carries a dot when something is attached.

ANMELDUNG, Markenfläche mit Blatt (seed 20ad6a35, dealt index 5). THESIS: the brand's primary-container field holds the G€ plate, "Girovo" and, on the first step, "Banking direkt mit deiner Bank – ohne jemanden dazwischen."; the steps rise over it as a 28px-cornered sheet. After the first step the field shrinks to the plate and the name. Quick picks are logo tiles, four by two: white tiles by day, the inset by night.
