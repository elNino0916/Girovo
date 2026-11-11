---
name: Girovo
description: German online banking over FinTS, on your own machine. A private branch for one customer.
colors:
  md-primary: "#0060a8"
  md-on-primary: "#ffffff"
  md-primary-container: "#d3e4ff"
  md-on-primary-container: "#004880"
  md-secondary: "#535d7e"
  md-secondary-container: "#dae1ff"
  md-on-secondary-container: "#3c4665"
  md-tertiary-container: "#e2dfff"
  md-surface: "#f8f9ff"
  md-surface-container-lowest: "#ffffff"
  md-surface-container-low: "#eff4ff"
  md-surface-container: "#e9eefa"
  md-surface-container-high: "#e3e8f4"
  md-surface-container-highest: "#dde3ee"
  md-on-surface: "#161c24"
  md-on-surface-variant: "#404753"
  md-outline: "#707784"
  md-outline-variant: "#bfc7d5"
  md-inverse-surface: "#2b313a"
  green: "#0c7336"
  green-soft: "#eaf4ee"
  red: "#c8102e"
  red-soft: "#fcecee"
  amber: "#8a6410"
  amber-soft: "#fff4dc"
  info: "#0074a3"
  info-soft: "#e9f4f8"
  emphasis: "#d9540f"
  brand-plate: "#0a2c5e"
  plus-gold: "#f2c14e"
  ai-mark: "#7b4fe0"
  ai-mark-dark: "#b085ff"
  chart-1: "#0053a4"
  chart-2: "#0ca4a0"
  chart-3: "#5f38a7"
  chart-4: "#e968a1"
  chart-5: "#3846b1"
  chart-6: "#049cd1"
  chart-rest: "#8a96a3"
  chart-in: "#2a9a5a"
  chart-out: "#30588f"
  doc-ink: "#1b1f24"
  doc-navy: "#0a2c5e"
  doc-rule: "#b4bfcc"
typography:
  display-entry:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "64px"
    fontWeight: 500
    lineHeight: "72px"
    letterSpacing: "-0.025em"
    fontFeature: "'tnum', 'lnum'"
  display-balance:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 500
    lineHeight: "56px"
    letterSpacing: "-0.025em"
    fontFeature: "'tnum', 'lnum'"
  display-lead:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: "44px"
    letterSpacing: "-0.025em"
    fontFeature: "'tnum', 'lnum'"
  display-detail:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: "48px"
    letterSpacing: "-0.025em"
    fontFeature: "'tnum', 'lnum'"
  screen:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: "28px"
    letterSpacing: "0"
  section:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "24px"
    letterSpacing: "0"
  row:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "0"
  body:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  meta:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  subheader:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  label:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  mono:
    fontFamily: "IBM Plex Mono, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.06em"
  icon:
    fontFamily: "Material Symbols Rounded"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1
    fontVariation: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  lg-up: "20px"
  xl: "28px"
  full: "9999px"
spacing:
  seam: "2px"
  stack: "8px"
  row-gap: "12px"
  gutter: "16px"
  gutter-wide: "20px"
components:
  search-bar:
    backgroundColor: "{colors.md-surface-container-high}"
    textColor: "{colors.md-on-surface-variant}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    height: "56px"
  button-primary:
    backgroundColor: "{colors.md-primary}"
    textColor: "{colors.md-on-primary}"
    rounded: "{rounded.full}"
    height: "40px"
  button-tonal:
    backgroundColor: "{colors.md-secondary-container}"
    textColor: "{colors.md-on-secondary-container}"
    rounded: "{rounded.full}"
    height: "40px"
  filter-chip:
    textColor: "{colors.md-on-surface-variant}"
    rounded: "{rounded.sm}"
    height: "32px"
  avatar-disc:
    backgroundColor: "{colors.md-surface-container-high}"
    textColor: "{colors.md-on-surface-variant}"
    rounded: "{rounded.full}"
    size: "40px"
  booking-row:
    textColor: "{colors.md-on-surface}"
    typography: "{typography.row}"
    padding: "10px 16px"
    height: "64px"
  nav-bar:
    backgroundColor: "{colors.md-surface-container}"
    textColor: "{colors.md-on-surface-variant}"
    height: "64px"
  settings-row:
    backgroundColor: "{colors.md-surface-container}"
    rounded: "{rounded.xs}"
  sheet:
    backgroundColor: "{colors.md-surface-container-low}"
    rounded: "{rounded.xl}"
  tab-primary:
    textColor: "{colors.md-on-surface-variant}"
    typography: "{typography.subheader}"
    height: "48px"
  tab-primary-selected:
    textColor: "{colors.md-primary}"
    typography: "{typography.subheader}"
  bank-tile:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    height: "56px"
  plus-plate:
    backgroundColor: "{colors.brand-plate}"
    textColor: "{colors.plus-gold}"
    rounded: "{rounded.sm}"
    size: "32px"
---

# Design System: Girovo

## Overview

**Creative North Star: "The Private Branch"**

Girovo is a bank branch that opens for one person. Nothing on the walls sells anything, every figure is the bank's own, and the counter is tidy. The look is Material 3 Expressive, drawn by the real `@m3e/web` components (wrapped in `components/ui/`), in Google Sans Flex, on Material You's wallpaper roles on an Android phone and on Girovo's own blue scheme everywhere else (`app/material.css`).

The phone is the system's reference. Its home has one field at the head that searches every booking, action and setting and, on Android, answers a question about the bookings. Below it, with more than one account, every account at once: the Gesamtsaldo set flat, the kinds as chips, the accounts under their groups with their last booking (issue #19, 6.0). A press opens an account's page: its balance set flat, a row of chips, then the bookings. Three places stand at the foot. The page is flat and list-first; tone, weight and space carry the hierarchy, and the colours that carry a value never follow the wallpaper.

The desktop (from 640px) followed the phone on 2026-10-24 (owner's choice): the Material Symbols, the type, the transfer's two parts, the tabbed Umsatzdetails and the brand-field Anmeldung. On 2026-11-04 it got a frame of its own, "Konten als Ebenen" (Round 6, the owner's pick; mocks in `.impeccable/mocks/desktop-shell/`): Google's desktop Material 3 Expressive instead of the phone's rail scaled up. A title bar and a labelled sidebar stand on a tinted canvas, the page is one white sheet beside them, and the accounts are layers ticked on and off like Calendar's calendars. The frame is the desktop's alone (`useDesktopFrame`: not `IS_ANDROID`, and at least 640px wide); Android keeps the classic shell at every width. What stays Android only — the wallpaper's colours and chart tones, the transitions, the phone's sheets and touch targets — is `IS_ANDROID` in code and `html[data-platform="android"]` in CSS.

**Key Characteristics:**
- Search-first home: a 56dp search bar is the only tinted shape at the top.
- A flat 48/500 balance with tight tracking; no balance card at any width.
- Three text sizes (12, 14, 16), one section step (18), one screen step (22), and display figures.
- Weight 500 for emphasis; rank is weight and tone before size.
- Owned value colours: green, red, amber and orange each mean one thing.
- Three places, no FAB on the phone; Material Symbols Rounded, the current place filled.

## Colors

Material's colour roles carry surfaces, ink, lines and the one interactive colour; Girovo's tokens (`--paper`, `--ink`, `--accent`, …) map onto them in `app/material.css`. Girovo's scheme sits at zero specificity so Material You's runtime roles win on the phone. The frontmatter holds the light values; the dark theme keeps the names. "Schwarzer Hintergrund" (`<html data-black>`, a switch under Sprache & Darstellung, off by default) puts the dark theme's page on #000 and leaves every surface that stands on it at its tone; the desktop's sheet keeps its edge with a hairline.

### Primary
- **Girovo Blue** (`md-primary`; `accent`, `focus`, `chart-line`): what can be pressed. Filled buttons, links, a checked control, a focused field, the sparkline, the Kontoverlauf line, Einstellungen's group subheaders.
- **Blue Container** (`md-primary-container`; `stage`): the rail's FAB and the Anmeldung's brand field.

### Secondary
- **Tonal Wash** (`md-secondary-container`): the tonal button, a selected chip, the navigation indicator pill.
- **Tertiary Lilac** (`md-tertiary-container`): the chosen item of a radio or checkbox menu, nothing else.

### Value Colours (owned; never follow the wallpaper)
- **Credit Green** (`green` on `green-soft`): a credit, a confirmation, a successful outcome.
- **Soll Red** (`red` on `red-soft`): a negative balance or an error. Never a debit, never a credit card's balance.
- **Vorgemerkt Amber** (`amber` on `amber-soft`): pending and nothing else. The Vorgemerkt chip's dot, a Vormerkposten's disc.
- **Info Cyan** (`info` on `info-soft`): neutral status notices.
- **Marker Orange** (`emphasis`): a mark, never text. The unread dot, a warning's glyph, an emphasis tag's dot. Dark enough to hold 3:1 as a mark on the page and on the avatar's disc (#d9540f; the brighter #ee6a1f fell to 2.4:1 on the disc).

### Neutral
- **Page** (`md-surface`; `paper`, `bar`): the page and the top bar, one plane. On Android the bar takes Container once the page scrolls under it.
- **Container Low** (`md-surface-container-low`): sheets, drawers, menus, popovers.
- **Container** (`md-surface-container`; `nav-bg`): the navigation bar, Einstellungen's grouped rows, the AI wash's ground.
- **Container High** (`md-surface-container-high`; `inset`, `dialog-bg`): the search bar, the avatar disc, wells, skeletons, basic dialogs.
- **On Surface** (`ink`): text, debit amounts, everything that reports.
- **On Surface Variant** (`ink-2`): meta lines, day headers and subheaders on the phone, labels.
- **Outline / Outline Variant**: a field's outline; a chip's edge and the hairline inside floating layers.
- **Inverse Surface**: the snackbar.

### Brand and Partner Colours (literal)
- **Brand Navy** (`brand-plate`): the G€ plate only.
- **Plus Gold** (`plus-gold`): the G€ in gold on the navy plate, Girovo Plus's mark and every door to Plus.
- **Girovo's AI** (`ai-mark`, `ai-mark-dark` by night; `--ai-mark`, `--ai-wash` in `app/material.css`): the mark's one colour, Girovo Next's violet, and a thin 115° wash over Container (the violet at 22%, a lighter violet at 12%, Girovo's blue at 10%) under everything Girovo's AI wrote. Text on it keeps the row's ink. Not Gemini's colours or spark (owner, 2026-11-11): Girovo never borrows a provider's branding.

### Chart Palette
Categories take `chart-1` to `chart-6` **by rank** within a chart; the rest are `chart-rest`. The slots are an order, not a mapping. Income is `chart-in`, spending `chart-out` (never red). The Kontoverlauf is a staircase line over a flat 12% area, never a gradient.

- **Everywhere but Android:** the fixed slots in the frontmatter, chosen to avoid green, red, amber and orange and to stay apart under protan and deutan simulation.
- **Android (owner, 2026-10-23):** the wallpaper's tones by rank: primary, tertiary, primary at 62%, secondary, tertiary at 62%, secondary at 62% (each mixed in oklab toward the surface); the rest is `md-outline`. Colour only groups here: the label and amount beside every bar carry the meaning.

### Named Rules
**The Owned Colours Rule.** Green is a credit or a confirmation. Red is a negative balance or an error, never a debit: a debit is ink. A credit card's balance stays ink (a card is known by its Kontoart, `isCardAccount`). Amber means Vorgemerkt and nothing else; a warning is an orange glyph. Orange is never text.

**The Fixed Values Rule.** The value colours (including `chart-in` and `chart-out`), the brand plate, Plus Gold and the AI mark's violet never take a wallpaper colour. Surfaces, ink, lines, the interactive colour and, on Android only, the six category slots and the rest follow Material You.

**The Tokens Only Rule.** Tailwind's default palette is switched off; every colour is a token. Literal colours exist only for literal things: the plates, a QR or TAN plate, the chipTAN flicker field.

## Typography

**Interface Font:** Google Sans Flex (with Segoe UI, system-ui, sans-serif)
**Mono Font:** IBM Plex Mono (with Cascadia Mono, Consolas, ui-monospace)
**Icon Font:** Material Symbols Rounded, a self-hosted 15 KB subset of 161 glyphs (fetched from Google Fonts' `icon_names` subsetting; a new icon means a new subset with every old name plus the new one) (`public/fonts/material-symbols-rounded.woff2`, `font-display: block`, declared in `app/material.css`). It sets icons only, never words.

**Character:** Google Sans Flex is round, calm and Material's own face; its optical-size axis draws a 48px balance and 8pt paper from one file. Plex Mono appears only where someone checks characters against another document.

### Hierarchy (every platform, `app/material.css`; the phone's first)
- **Display entry** (500, 64/72, −0.025em): the amount typed into the transfer, with the € at 34px in the variant ink.
- **Display balance** (500, 48/56, −0.025em): the Übersicht's balance, cents at 0.58em (about 28px).
- **Display lead** (500, 36/44, −0.025em): a screen's one lead figure, such as Analyse's Ausgaben. The range is 32 to 36.
- **Display detail** (500, 40/48, −0.025em): a booking's amount in the Umsatzdetails header.
- **Screen** (500, 22/28): a sheet's or screen's title. The top bar's page name is 22/28 at 400.
- **Section** (500, 18/24, ink): a section on the page (`.section-head`).
- **Row** (500, 16): a row's name and its amount.
- **Body** (400, 16/24): running text, fields, the search bar's placeholder.
- **Meta** (400, 14/20, variant ink): a row's second line, Verfügbar, a comparison line.
- **Subheader** (500, 14/20, variant ink): a day header, a group inside a section ("Vorlagen", "Zuletzt bezahlt"), a figure's label.
- **Label** (500, 12/16): navigation labels, supporting text, small notes.

Sizes in between snap: 12.5 to 12; 13 to 14 to 14; 14.5 to 16 to 16; 17 and 18 to 16/500; 20 to 24 to 22/500.

### Named Rules
**The Symbol Rule.** Every app icon is a Material Symbol (`Icon`'s `ms` name) in a box of exactly 1em, sized in px (dp on the phone), so larger system or browser text grows the words, never the glyph: on the phone the icon is zoomed out by the text zoom and its box zoomed back in (see Large Text). `filled` sets FILL 1, used only for the current place in the navigation (24px). Girovo's AI mark and the avatar glyphs are pictures and stay drawn. A glyph that is only an outline at 18px may read as a letter (the flag read as an "F"): such an icon is drawn solid. The icon's own `display` sits in the base layer, so `hidden` and the Darstellung's glyph switch decide whether it shows.

**The Two Headings Rule.** A section is 18/500 in ink; a subheader is 14/500 in the variant ink. Einstellungen keeps its subheaders in the primary (owner, 2026-10-20). There is no third treatment.

**The Medium Weight Rule.** Emphasis is 500, never 600 or 700. Rank comes from weight and tone before size.

**The Tight Figures Rule.** No positive tracking on figures. An amount is −0.01em; a display figure (`[data-balance]`, `[data-figure]`) is −0.025em. Body text keeps the face's own spacing (0).

**The Kontoauszug Column Rule.** Every amount goes through `<Money>`: tabular lining figures, a real minus (U+2212), and the privacy mask ("••• €") under Beträge ausblenden. Dates and counts take `.tnum`.

**The Character-by-Character Rule.** IBAN, BIC, BLZ and references are in Plex Mono. An IBAN gets 0.06em tracking and never wraps.

**The Sentence Case Rule.** Labels are sentence case, never capitals, on screen and on paper.

## Layout

**Phone (below 640px).** One column with 16px gutters; sections reach the screen's edges and are held apart by space. The top bar reaches under the status bar. Touch targets are at least 48dp. The bottom navigation bar is 64dp plus the gesture bar and is a row of the page's column, so nothing scrolls under it.

**The Übersicht, top to bottom:** the search bar (56dp, fully round, 8dp under the status bar, holding the search glyph, "Umsätze suchen oder fragen", Girovo's AI mark where a question can be asked, and the 32dp avatar with the unread dot); the account name with its chevron and, at the row's end, the eye for Beträge ausblenden; the balance with Verfügbar under it, then on its own line the date or, for today's figure, its freshness ("Stand 13:57 Uhr", the time of the read), and the sparkline (96×36 in a 112×48 target) at its baseline, which opens the details in place; one sideways-scrolling chip row (Vorgemerkt, Eingänge, Ausgänge, Kategorie, Monat, then the period and the export); then day headers and rows. That is an account's page, and the Übersicht itself with a single account.

**Every account (the Übersicht's start with more than one account, issue #19, `AccountsOverview.tsx`):** under the search bar "Gesamtsaldo" (14/500 variant ink) with Konten anordnen (`swap_vert`) and the eye at the row's end; the Gesamtsaldo as the display balance; "6 Konten bei 2 Banken · Stand 14:02 Uhr" (the oldest read it is made of); Vermögen and Verbindlichkeiten (label 14 over 16/500, each account counted by its own sign) only once something is owed; the kinds as filter chips (Alle, Girokonten, Sparen & Anlegen, Karten & Kredite, by FinTS Kontoart, `lib/account-overview.ts`); then the groups, each a subheader with its sum at the figures' edge, and the accounts: the 40dp disc with the account's kind (the bank's mark on its edge when there are several banks), name and figure in row type, bank and the IBAN's end in meta, the last booking and its amount in meta. A card's or loan's figure stays ink. Until every figure is known the Gesamtsaldo's place says "Noch nicht vollständig", names what is missing and offers "Alle Salden abrufen" with "Kann eine Freigabe erfordern." — never a partial sum, never a read on its own. A row opens the account's page, whose top bar on the phone is the way back, the account's name, the search and the eye (no avatar), with the bank and the IBAN's end under it; the back gesture, the back arrow and the Übersicht pressed again lead back, focus returning to the row.

**Konten anordnen:** a bottom sheet (a dialog from 640px): the title, "Halte ein Konto fest und zieh es an seinen Platz.", "Gruppieren" over a connected group (Nach Art, Nach Bank, Keine), then each group's rows with a 48dp `drag_indicator` grip, the disc, the name over the IBAN's end, and the figure; "Fertig" pinned at the foot. A row lifts by its grip at once, or after a 350ms hold anywhere on it, onto the page's surface with the floating shadow and a −0.6° tilt while the others make room on the fast spatial spring; the grip's arrow keys move it by one place and say where it now stands. Every change goes to the vault at once.

**Side by side (the classic shell, so Android, from 1280px with more than one account, 6.0, the owner's pick from `.impeccable/mocks/issue-19/desktop-nebeneinander.png`):** the Übersicht's column widens to 1360px (the search bar with it, `SPLIT_SEARCH_EDGES`) and holds two panes: every account in a 420px pane on the left, sticky with its own scroll and a hairline at its right edge, and the open account's page beside it. The pane is the overview in short: the Gesamtsaldo as a lead (36/44), Vermögen and Verbindlichkeiten under it, the kinds as chips that wrap, then compact rows — the disc, the name over the last booking, the figure — the open account in Material's selected list item (the secondary container, 16px round, its disc a 12% tint of that ink). No table, no grouping menu (it is in Konten anordnen), no footing. A press on a row changes the page beside it, which keeps its head without the way back. Below 1280px the single column returns, on whichever level was open.

**Kept balances and the Gesamtsaldo's curve (6.0, `lib/kept-balances.ts`):** each account's last balance is kept in the vault with when it was read ("Letzte Salden behalten", on unless switched off, which deletes them), and the overview's figures once a day when every figure was known. Until a read of this session replaces it, a kept figure stands in the variant ink with "Stand gestern, 18:02 Uhr" said to a screen reader and, in the table, under it; the Gesamtsaldo then counts it, its line names the oldest read, and on a phone a tertiary "Alle Salden abrufen" with "Kann eine Freigabe erfordern." follows. With two days kept, a 96×36 sparkline in a 112×48 target stands at the Gesamtsaldo's baseline and opens the curve in place: "Verlauf des Gesamtsaldos" over its range, the staircase chart (a day without a reading carries the last one) and a 12px caption saying so. "Salden beim Anmelden abrufen" (Allgemein, off unless switched on) reads every balance once the login's own reads are done.

**Every account from 640px (the classic shell, so Android):** the same column as a table — Konto · Letzter Umsatz · Kontostand under 12/500 heads; a row holds the disc, the name over the whole IBAN (the bank is the disc's mark, said to a screen reader), the last booking's name over its long date and amount, the figure over what it is (Verfügbar, Depotwert, Kartensaldo, Restschuld) and a chevron on hover; rows are 16px round in their hover state and bleed 20px like every flat section. "Anordnen" is a text button; the grouping is a menu chip at the chip row's end beside "Alle Salden abrufen" (refresh); the Gesamtsaldo foots the table under a rule. An account's page keeps the search bar and heads the balance with the way back, the name and the eye.

**The desktop's frame, "Konten als Ebenen" (640px and up, never Android; `components/shell/frame.ts`, `FramedDashboard`):** the window is a canvas (`--frame-canvas`: Container Low by day, Container Lowest by night, the colour the caption buttons sit on, `components/shell/CaptionButtons.tsx`) holding the title bar across the top and the sidebar down the left. The page is a sheet beside the sidebar (`--frame-sheet`: Container Lowest, white, by day, Container Low by night), 16px round, 16px from the window's right and bottom edges, with its own scroll. Inside the sheet the page's ground is the sheet's, so a sticky day header matches it. Every page but the ledger keeps a 1280px column with 28px sides; the page's name is said to a screen reader, and shown only where the page draws it (Zahlungen, Aufträge).

**The title bar:** exactly the caption overlay's height (`--barbar-h`), on the canvas. Over the sidebar the menu button that folds it, then, while it is open, the G€ plate (28) and "Girovo". At the sheet's left edge the search, the field itself and never a button for a dialog (`FrameSearch.tsx`): a 44px pill up to 640px wide on Container High (Container Highest on hover), the search glyph, "Umsätze und mehr suchen" at 16, and "Strg K" on a key cap. With the caret in it the pill becomes Material's docked search view: one container on Container High, 22px round, with the floating shadow, the field its top, the results under a hairline (Aktionen, Konten, Umsätze, as the phone's search view) and the keys at its foot, up to 640px tall over the page, with no scrim. A clear button replaces the key cap once something is typed. Esc, a choice, a press elsewhere or Tab away close it, and the caret goes back where it was. Then the bell with the unread dot, the eye for Beträge ausblenden, the Darstellung and the avatar, clear of the caption buttons (`--caption-inset`). The whole band drags the window except its controls; "/" opens the search like Strg K.

**The sidebar (`--frame-side`):** 272px open, a 96px rail folded. It opens on its own from 1100px and folds below; the menu button switches it, and the choice is kept. Open, top to bottom: Überweisen, M3E's extended FAB in the primary container (small, lowered); the three places as M3E nav-menu items, 40px pills the sidebar's width, labels 14/500 in ink, the current place in the secondary container with its icon filled, and on Zahlungen a badge, "3 fällig" (14/500), for the debits due in 30 days from the ticked accounts; the month; "Konten"; Einstellungen at the foot. The icons, the month and the checkboxes share the sidebar's 28px edge, which takes `--m3e-nav-menu-item-padding: 24px` because M3E draws the icon 8px into its padding. Folded, the FAB keeps only its icon and the places are M3E's vertical nav items, icon over label, with no month and no accounts. On Einstellungen the sidebar is the way back, "Einstellungen" at 22/500 and its pages as 40px pills, each a 22px glyph and its name, the page on the sheet in the secondary container with its glyph filled; the sheet shows that one page under its name at 22/500.

**The month (`MiniMonth.tsx`; M3E's calendar is drawn for a dialog):** the month's name at 14/500 with two chevrons, weekday initials at 12/500 in the variant ink, six weeks from Monday in 32px rows, days at 12/500 in tabular figures. Today is filled in the primary; a picked day is a 1.5px primary ring; a 4px dot under a day with bookings of the ticked accounts (the Übersicht only), a 4px ring under a day a payment is due; a 12px legend (Umsätze, Fällig) under it. On the Übersicht a day pressed narrows the bookings to it through the provider's `txFilter` (from and to that day), so the ledger and an account's page narrow alike; pressed again, the whole period returns. In Analyse the analysed month is a band in the secondary container with round ends, and a day pressed chooses its month. On Zahlungen it only marks.

**Konten, the accounts as layers (`overview/layers.ts`, `AccountLayers.tsx`):** "Konten" at 14/500 in the variant ink with "+" (a further bank) at the row's end; then one 36px row per account in the user's order: an M3E checkbox in the account's layer colour (its fill and its empty outline), the name at 14, the figure at 14/500 ("–" until known; a kept figure in the variant ink). An unticked account's name and figure turn to the variant ink. The layer colours are the chart slots `chart-1` to `chart-6` by place in the order. The tick puts an account's bookings and balance into the Übersicht or takes them out; a press on the name shows that account alone, its row then on Container. Which accounts are hidden is kept in the vault as `accountsHidden`, this device's own and never synced.

**The Übersicht in the frame:** one ticked account is its page; several are the ledger (`Ledger.tsx`), which runs the sheet's width at 28px sides; none says "Kein Konto angehakt." and where to tick one. The ledger's head: while a ticked balance is missing, "Gesamtsaldo noch nicht vollständig" at 22/500, "Noch nicht abgerufen: …" at 14, and one tonal "Alle Salden abrufen" with "Kann eine Freigabe erfordern." — never a partial sum. Complete, "Gesamtsaldo" at 14/500 in the variant ink ("· 3 von 4 Konten", and a line "Notgroschen ausgeblendet", once an account is unticked) over the sum as the display lead (36/44, cents at 0.58em); Umsätze not yet read are a quiet line with a tertiary "Umsätze abrufen", never a second prompt. The month's figures stand at the head's trailing edge: Eingänge and Ausgänge for the month's days, Demnächst fällig over 30 days, labels 14 in the variant ink over values 16/500, no tile. The filter bar: Eingänge, Ausgänge, Kategorie, Monat, then the period chip and refresh. Then the bookings of every ticked account by day, under 36px day headers with the day's Summe. The CSV export and the Kontoauszüge belong to one account and live on its page.

**An account's page in the frame (one ticked of several):** its head says "Nur dieses Konto · Alle Konten zeigen" (14/500 variant ink, the second part a link in the primary), the name at 22/500, and the bank's mark, its name and the IBAN's end at 14. There is no way back (the sidebar is it) and no eye (the title bar has it). The balance, Verfügbar, the freshness, the sparkline that opens the Kontoverlauf and the month's figures follow as on the phone; the filter bar leads with Vorgemerkt and ends with the period, refresh and the export (CSV, Kontoauszüge); a day header carries the day's Kontostand where the statement proves it.

**Zahlungen, top to bottom:** Überweisen (filled) and Geld anfordern (tonal), equal width; "GiroCode scannen" (Android); Vorlagen; Zuletzt bezahlt; the forecast; the row to the bank's orders; "Verträge & Abos".

**Zahlungen in the frame (`Contracts.tsx`, `PayActions`, `ForecastChart`):** a head row with "Zahlungen" at 22/500 and, at the trailing edge, Geld anfordern and Rechnung öffnen as small tonal buttons (Überweisen is the sidebar's FAB). From 1180px two columns 48px apart, one below. The left column: Vorlagen and Zuletzt bezahlt, the row to Daueraufträge und Terminüberweisungen, and the Verträge & Abos row (the disc with `receipt_long`, "11 erkannt · Fixkosten pro Jahr mind. …", a chevron), which opens them as a view with a back button and their name at 22/500. The right column: the month-end forecast with its figure, its lowest point and any overdraft warning (the Flat Page Rule's boxed callout), then its chart, 120px tall: a staircase of one step per day in a 2px primary line over a flat 12% area, a dashed zero line in the outline variant when the balance goes below zero, the lowest point an 8px dot in Marker Orange, the first and last day at 12 under it. Under the chart "Fällig bis Monatsende" (subheader) and up to six 40px rows: the date, the payee's cleaned name at 14/500, the amount.

**Aufträge (6.0, `BankOrders.tsx`):** the bank's Daueraufträge and Terminüberweisungen on a page a level below Zahlungen. Its row there is the booking row's shape (the disc with `repeat`, "Daueraufträge und Terminüberweisungen", then "3 Daueraufträge · 1 Terminüberweisung" once read or "Bei deiner Bank – noch nicht abgerufen", a chevron). The page's top bar says "Aufträge" with the way back at every width (the rail has no other); the back gesture and Zahlungen pressed again lead back too.

**Überweisung, "Betrag zuerst" (every platform; a full-screen dialog on the phone, the centred dialog on the desktop):** two parts and the review, with a three-segment bar (4px, the primary over the progress track) in the header: Betrag, An wen?, Prüfen. Part one holds the account, the amount typed into the figure (decimal keyboard), Verfügbar and any funds warning under it, Ausführung and Termin; its footer is "Abbrechen" with "Weiter: An wen?". Part two holds the payee section and the Verwendungszweck; its footer is "Zurück" with "Weiter zur Prüfung". Every check stays the form's; a problem in the amount part sends the user back to it. After the review the title names the step; there is no stepper. With a fine pointer, part two starts in the name.

**Umsatzdetails, "Registerkarten" (every platform):** on the phone a full-page drawer whose body takes the page surface, on the desktop the side drawer, the tabs running to its edges. A left-aligned header (the 56dp disc, the name at 22/500, the booking text and time at 14, the amount as display detail, the state tags, the actions) over primary tabs: Details, Notiz & Belege, Kategorie.

**Drawers on the desktop:** the header is a band of the page's surface at the title bar's height (`--barbar-h`), so in the desktop shell the OS caption buttons sit in its trailing corner. The drawer grows by their width (`--caption-inset`) and its title keeps the room a browser gives it; the close button leads the header from 640px up, its glyph on the body's 24px edge, so it is never read as a fourth caption button. On the phone it stays at the trailing end.

**Anmeldung, "Markenfläche mit Blatt" (the phone, and a narrow browser window):** a primary-container field holds the language switch, the G€ plate (48, then 36 after the first step), "Girovo" at 28 (22 after) and, on the first step only, "Banking direkt mit deiner Bank – ohne jemanden dazwischen." The steps sit on a paper sheet with 28px top corners that rises 28px over the field, with a handle-shaped mark. Quick picks are logo tiles, four by two, on every platform.

**Anmeldung on the desktop (640px and up):** the field is the window's left column (`clamp(240px, 28vw, 400px)`, top to bottom, dragging the window) with the plate at 48, "Girovo" at 28, the brand line and the version at its foot; the paper sheet rises 28px over it from the right with 28px left corners. The sheet's top strip is the title bar (language, Darstellung, the update), on paper so the OS caption buttons match it. The side tile beside the form switches on the sheet's width (the `auth` container, 59rem), not the window's.

**Analyse:** Ausgaben leads as the display lead with its comparison line; the other figures are label and value rows (14 label, 16/500 value).

**Desktop (640px and up).** The frame: the title bar and the sidebar (272px, or the 96px rail) on the canvas, the page on the sheet. Every page but the ledger is a 1280px column inside the sheet. A flat section reaches 20px out (its rows are inset 20px), so rows, chips and headings share the page's left edge. The classic shell's wide layouts (the rail, Side by side, the table of every account) are Android's.

### Named Rules
**The Reading Order Rule.** The DOM order is the narrow reading order. A wider layout places blocks with the grid, never with CSS `order`.

**The Phone's Page Rule.** On an account's page the bookings are visible without scrolling. Whatever would push them down (summaries, the chart) goes behind a tap. With more than one account the home is every account (issue #19), and the bookings are one press away.

**The Layers Rule.** On the desktop the ticked accounts are the Übersicht: their bookings one ledger, their balances one sum (never a partial one), and one ticked alone is that account's page. Zahlungen's badge, the month's marks and Analyse's scope (across the ticked accounts when there are several, the one account otherwise) follow the same ticks. A layer's colour is its chart slot by order, the same on its checkbox and on its rows' dot.

## Elevation & Depth

Flat by default. A container is told from the page by tone, not by edge or shadow. Shadow belongs only to what floats: menus, sheets, drawers, the snackbar (`level3`), Android's pull-to-refresh disc, the Anmeldung's sheet over its brand field (a soft upward shadow). On the desktop a white tile keeps a whisper of shadow (`shadow-tile`) by day and a 1px light edge by night. The frame's sheet has none: it is told from the canvas by tone and its corners. The sidebar's Überweisen keeps M3E's lowered FAB elevation. The full values are in the sidecar.

### Named Rules
**The Flat Page Rule.** A section on the page has no surface, corners, shadow or hairline between rows. The page has no container at all; on the desktop the page is the frame's sheet itself, and nothing inside it is boxed. The first exception is Einstellungen (owner, 2026-10-20): Material 3 Expressive's grouped list, rows as tiles on Container, 2px seams, 20px outer corners, 4px inner ones. The second is a warning the reader must not miss, as the forecast's overdraft warning: a tonal callout on Container High, 12px round, its glyph in Marker Orange.

**The Scroll Edge Rule.** A pinned header or footer inside a sheet is flat while everything fits; a 1px hairline appears only once content runs under it.

## Shapes

Material's corner scale (`--m3e-corner-*`). Fully round: the search bar and the title bar's search pill, the sidebar's nav pills, buttons at rest (they squeeze square while pressed and spring back), the avatar disc, the navigation pill. Small (8px): chips, the brand plate. Large (16px): the frame's sheet, tiles, the AI answer, the Anmeldung's bank tiles. Extra-large (28px): sheets, the Anmeldung's sheet, basic dialogs. Extra-small (4px): outlined fields, snackbars, a grouped row's inner corners. On a phone a multi-step flow is a full-screen dialog with no corners, and a bottom sheet has a 32×4 drag handle.

## Components

### Buttons
- **Primary** is M3E's filled button in the primary; **secondary** is the tonal button. There is no outlined secondary.
- **Quiet** is a text button in the variant ink; **danger** is filled in Soll Red, only for a destructive confirm the user asked for.
- **Connected groups** that span the phone's width (Termin: Sofort · An einem Datum · Regelmäßig) take 8px sides, and each segment is sized by its label and may shrink, so the group never runs past the screen.

### Search
The Übersicht's head (`Masthead.tsx` SearchBar) opens the search (`CommandPalette.tsx`), on the phone as Material's full-screen search view. On Android a question-like query hands over to "Frag deine Umsätze" in Analyse. On the other pages the search is an icon (a phone) or a pill (a wide window) in the top bar, and Strg K or "/" everywhere. The Umsätze have no search field of their own: a search handed over shows as a chip. On the desktop the search is the title bar's pill on every page.

### Chips
M3E filter chips, 8px corners; a selected chip is the tonal wash. The Vorgemerkt chip carries an 8px amber dot and opens the pending sheet; Eingänge and Ausgänge toggle; Kategorie and Monat open menus.

### Booking Rows
A 40dp disc on Container High in the variant ink: the category glyph, or initials for a person. A merchant logo, when one is known, takes a white rounded tile instead. A Vormerkposten's disc is amber. Name and amount are row type; credits are green, debits ink. The meta line is the category and, on the phone, the payment method, whole or not at all; the bank's prose waits for the detail drawer. Rows are at least 64px. On the desktop (the frame) a row is one line at 48px: the 32px disc, the name at 14/500 in 34% of the row, the category · method in the variant ink, in a ledger of several the account with its layer's 8px dot (150px), and the amount at 14/500 right-aligned in 112px. A row with no category to show says its method or its quiet category ("Sonstiges"), never the bank's prose.

### Tabs (Umsatzdetails)
Material's primary tabs, 48px, labels at 14/500: the variant ink at rest, the primary when selected, with a 3px indicator under the middle of the label and a 1px line under the row. Arrow keys move between tabs. A tab with something attached carries a 6px dot in the primary, and its name says so to a screen reader (sr-only text), never by the dot alone.

### Bank Tiles (Anmeldung)
On Android: 56px tall, 16px corners, white with a 1px inset hairline by day (banks draw their marks for white), the inset colour by night. The label under the tile is 12px on one line; a long name of two words takes two lines and never gets a hyphen.

### Day Headers
Subheader type on the page's own ground, sticky. A Buchungstag still ahead says "noch nicht gebucht" with a clock glyph, in the variant ink; amber stays Vorgemerkt's. In the frame a day header is 36px high, the day's Summe (Kontostand on an account's page) at its trailing edge.

### Einstellungen (6.0)
Eight pages, one shown at a time (`lib/settings-pages.ts`): Anmeldung & Sicherheit, Benachrichtigungen; Konten & Umsätze, Daten & Geräte, Datenschutz, Frag deine Umsätze (Girovo Next; on Android where the phone can ask); Sprache & Darstellung (on Android "Sprache"), Über Girovo. A page with nothing on it is left out. On a phone Einstellungen opens on their list, in those three clusters as separate grouped lists (Plus above them in the Play build): a 40dp disc in the primary container with the page's 22px glyph, the name at 16/500, and under it at 14 what is on the page or how it is set ("Fingerabdruck, automatisches Abmelden", "Deutsch"), two lines at most. A page opens as a screen of its own with its name in the top app bar; back leads to the list. Inside a page, rows group under primary subheaders where it holds several kinds of thing. Rows are 16 for the name and 14 for the line under it, with 22px glyphs. The search's setting opens its page.

### Scrollbars (the desktop, 6.0)
No native bar and no gutter: content reaches the sheet's edge. A thumb floats over whatever scrolls (`components/shell/FloatingScrollbars.tsx`): 6px, fully round, 4px from the edge and 8px from the ends, the variant ink at 72 %. It shows while the scroller moves or while the mouse is within 16px of its edge (then 10px and full variant ink), turns Girovo Blue while dragged, and fades a second after the last movement. The phone keeps Android's own overlay bars.

### Navigation
M3E's navigation bar on the phone, with three places: Übersicht · Zahlungen · Analyse (the internal tab id `contracts` is labelled Zahlungen). There is no FAB on the phone; Überweisen lives at the head of Zahlungen and in the search. On Android from 640px M3E's nav items form the 96dp rail, Überweisen as a small primary-container FAB at its top, Einstellungen at its foot. On the desktop the frame's sidebar holds them (Layout): Überweisen as M3E's extended FAB, the places as M3E nav-menu items, the month, Konten, Einstellungen at the foot; folded, M3E's vertical nav items. On the phone Einstellungen and Mitteilungen are rows in the Sitzung panel behind the avatar, and the avatar carries the unread dot.

### Girovo's AI mark
"Strich-Funke" (owner's pick, 2026-11-11, `.impeccable/mocks/decision/next-ai/mark/`): a twinkle drawn with the G€ plate's rounded strokes, four bars and two short diagonals at half strength, in the one AI colour (`AiMarkIcon`, components/icons.tsx). It marks Fragen, the month recap, the asking bars, the search bar and title bar where a question can be asked, and the AI rows in Einstellungen, on the AI wash. "Gemini Nano" stays plain text where Nano really reads a question (Einstellungen' model row on Play phones); no Gemini logo or colour anywhere. A model never states a figure; the app computes it.

### Fragen (Girovo Next, 7.0)
Asking is a conversation (owner's pick "Gespräch", 2026-11-11; `.impeccable/mocks/decision/next-ai/a-gespraech.png`). In Girovo Next the AI pieces stand on the AI wash with Girovo's own mark on every platform.
- **The thread** (`components/insights/AskThread.tsx`): a question in the search starts a conversation. On a phone it is a full-screen view, "Fragen" at 22 in the top bar with the way back, Gespräche (`history`) and Neues Gespräch (`add`); on the desktop it docks as a 420px panel at the sheet's right edge, its header 16/500 with the spark, and the page beside it shows what an answer opens. The user's turns are bubbles in the tonal wash (`accent-soft`, 20px round, 4px at the speaker's corner); Girovo's are tiles on the wash, 16px round, the 16px spark leading, the text 16/24 on the phone and 14/22 on the desktop. At the foot: the next questions as 32px chips outlined in the outline variant (concrete, "Und im September 2026?"; "Pro Monat" only where the period holds several months), then the composer, a fully round field on Container High (56dp on the phone, 48 on the desktop) with a filled send disc. The booking's asking bar uses the same composer.
- **Figures in a sentence** are the app's own (lib/nano-ask.ts computeAnswer), never the model's: tabular, 500, a 1.5px dotted primary underline at 4px; a press opens the bookings behind it. A figure that is no set of bookings (a difference) is 500 without the underline. Every figure goes through `<Money>`, so Beträge ausblenden masks it.
- **The words:** with Gemma ready (the desktop), Gemma reads the question (the rules correct it) and writes the answer from Girovo's facts (`lib/gemma-writer.ts`); a sentence with a number of its own, or a dash, is thrown away, and its amounts are drawn by the app again. Otherwise the templates in `lib/i18n/messages/ask.ts` (`thread.say`) say each answer in one or two short sentences that open on the period asked about ("Im September 2026 hast du für Lebensmittel 660,10 € ausgegeben, bei 15 Umsätzen."), a day in words ("am 5. Oktober"). A follow-up keeps what it does not say again (`lib/ask-followup.ts`). The conversations live for the session only and end with it.
- **The month recap** heads the Analyse where asking works: "Dein Oktober" (14/500) with a close (`Rückblick ausblenden`, this session only), two sentences, and "Weiter fragen" (tonal), which opens a conversation that starts with the recap; while that conversation is open the tile steps aside. It counts on the Analyse's basis (periodTotals: refunds netted, Umbuchungen left out) over every loaded account, and says "…, alle Konten" when the page below counts fewer. Only a whole, wholly loaded month gets one.
- **Elsewhere:** the booking's details end in a footer "Frag zu diesem Umsatz" on the wash (24px top corners) with two questions about the payee and a field; the transfer's review may show one history hint in the warning callout ("Lea hast du bisher 3-mal 25,00 € geschickt. Diesmal sind es 250,00 €."), which never blocks. The first question shows the app's small Dialog once (`vault.askIntroSeen`; a basic dialog on Android, a bottom sheet on a narrow web page), a sibling of the thread's layer; "Später" drops the conversation unasked. Einstellungen has the page Frag deine Umsätze (switch `vault.askOff`, the model row, the language of answers); on the desktop the model row is Gemma's download (src-tauri/src/gemma.rs): before it, "Gemma, etwa 3,4 GB" and where it comes from ("Lädt einmal von Hugging Face und GitHub.") with the tonal "Laden"; while it loads, the progress and "Abbrechen"; once here, "Gemma ist bereit" with "Löschen". On a phone without Nano the row stays a disabled "Laden" until that download exists.
- **Motion:** a sent question rises out of the field on the fast spatial spring, Girovo's tile follows on the default one, and Gemma's words arrive one after another out of a slight blur (effects never overshoot; `app/globals.css` `ask-*`). While Girovo works, the spark breathes, the step is named ("Liest deine Frage", "Schreibt die Antwort", "Gemma startet"), the seconds count from the third, and two lines shimmer where the answer will stand; reduced motion stills it all.
- **More than sums** (`lib/ask-intents.ts`, rules only): "Welche Abos habe ich?" lists the live Verträge & Abos with their monthly sum and the way to the page; a setting is read as it is (Darstellung, Beträge, Sprache, Abmeldung); a change ("helles Design", "Beträge ausblenden", "auf Englisch", "alle Konten aktualisieren") is asked first in the tile with a filled "Ja, bitte" and "Abbrechen", made only on the yes, then said in a sentence ("Erledigt, das helle Design ist an."); refreshing says "Kann eine Freigabe erfordern." Small talk gets one line pointing to the bookings.
- **Conversations** go from the header's trash (the open one), from "Alle Gespräche löschen" at the foot of Gespräche, and on the desktop from each sidebar row's own trash on hover or focus. The title bar's spark opens and closes the panel.
- **Never:** a line that says where the answer was worked out ("Auf diesem Telefon berechnet" and the like, owner 2026-11-11), a figure the model wrote, a hint that blocks moving money.

### Girovo Plus
The navy plate with the G€ in Plus Gold. Every door to Plus is the same tonal button with the gold plate as its icon. A locked figure is never shown blurred or greyed.

### Freigabe-App (Android; named on the desktop)
While the bank waits for a decoupled approval and its app is installed (`lib/brands.ts` APPROVAL_PACKAGES, each package also in the manifest's `<queries>`), the approval sheet's footer leads with the filled "S-pushTAN öffnen" (the app's own name), wide, and "Abbrechen" steps back to a quiet text button (owner's pick "Im Fuß", 2026-10-24). No app known for certain, or none installed: the footer as before.
On the desktop the approval is on the phone: when the bank's app is known for certain and the bank's own words do not name it, a line under the request says "Bestätige in S-pushTAN auf deinem Telefon." with the phone glyph, and no button (owner, 2026-10-24).

### Belege
"Beleg hinzufügen", a tonal button, opens a menu: Foto aufnehmen (Google's document scanner, which crops and straightens; several pages are kept as one PDF) and Datei wählen (owner's pick "Ein Knopf mit Menü", 2026-10-24). Without the scanner the system's picker opens.
On the desktop "Beleg anhängen" opens the system's picker, and a file dragged onto the section, or a screenshot or PDF pasted while it is in view (Strg+V), is kept as the booking's Beleg; dragging marks the section with a dashed primary outline, "Loslassen, um den Beleg anzuhängen" (owner, 2026-10-24).

### Rechnung ohne GiroCode
"Rechnung scannen" sits under "GiroCode scannen" at the head of Zahlungen. A page without a GiroCode is read for its text on the phone (`lib/invoice-text.ts`: an IBAN only with valid check digits and never the user's own, the amount only from a line that names it the amount to pay, the invoice number as Verwendungszweck, the payee from a label or a letterhead with a legal form). What it found fills the form; the page then heads the payee's part as a 150px thumbnail, the lines it took boxed in the primary at 14%, a press opens it large, and beside it the amount with "Ändern" and "Markiert ist, was übernommen wurde." (owner's pick "Rechnung daneben", 2026-10-24). An invoice that says it is collected by Lastschrift says so above the payee. Every check, the review and the Namensabgleich follow as for a typed transfer.
On the desktop "Rechnung öffnen" heads Zahlungen and the transfer's GiroCode strip takes a PDF or a picture: a PDF is drawn and read by pdf.js (its own text, no recognition), a photo or a scan by Tesseract (German and English), both offline from the app's own files (`components/transfer/desktop-read.ts`, `scripts/ocr-assets.mjs`). From 1024px the transfer widens and the invoice stands beside the form (owner's pick "Rechnung daneben", 2026-10-24): the page at the left column's width with the read lines boxed, the box of the field in use lit, and above the page, sticky, "Auf der Rechnung" with that line magnified, since a whole page at 444px sets its text at a few pixels. Narrower windows show the phone's thumbnail.

### Aufteilen (a Plus perk in the Play build)
From a debit's actions, a full-screen dialog (owner's pick "Anteile als Balken", 2026-10-24): the booking at its head; "Wer zahlt was?" over one bar of the shares, 48px, the user's own in the outline tone and the others in the chart slots by order, the chosen share drawn taller; a filter chip per person (their colour, name and share) and "+ Person"; the chosen person's name and share edited in place, the user's own share always what is left ("Dein Anteil passt sich an"); the Verwendungszweck ("Anteil Sushi Yana, 21.10."); the sum said in words with a green check, or in red when the shares ask for more than the booking. "Alle anfordern" closes the booking and opens Geld anfordern for each person in turn, its header naming them ("Für Lea · 1 von 2") and its footer going on ("Weiter: Jo", on the last "Fertig"); closing it ends the row.
On the desktop the editor is a dialog, and "Alle anfordern" opens one wide Geld anfordern with a card per person instead of the row (owner's pick "Alle nebeneinander", 2026-10-24): the person's initials on their chart tone, their name and share, their GiroCode, "Bild kopieren" and the save icon; the user's own share and account in the footer beside "Kontodaten kopieren" and "Fertig". Three cards to a row from 1024px, two from 640px, one below.

### Sparziele (a Plus perk in the Play build)
One goal per savings or Festgeld account (FinTS Kontoart 10–29), kept in the vault. Under the account's balance (owner's pick "Monatsplan", 2026-10-24): the goal's name at 16/500 with "noch …" at the row's end, then a strip of one 10px segment per month from the month it was set to its date, filled by the money (the balance's share of the target, so it never claims more than the money says), then "Plan: 98 € im Monat bis Juni 2027 · Monat 9 von 17". Without a date the strip is one bar; a reached goal says "Erreicht" with the green check. "Sparziel setzen" (a text button with the solid flag, or the Plus door) opens a bottom sheet: Name, Zielbetrag, "Bis wann? (optional)", the live "Das sind … im Monat", "Verschlüsselt nur auf diesem Telefon" and Speichern. Analyse lists every goal.
The desktop shows the same goal under the balance and in Analyse, free as everything there is.

### Large Text (Android)
The system's font scale reaches the page as WebView text zoom: it multiplies every font size and line height, no length in px, em or ch, and `text-size-adjust` does not opt out of it (WebView 149). `app/layout.tsx` measures it before first paint as `--text-zoom`; at 100% every rule below comes to nothing.
- What keeps its size is zoomed out by the text zoom: icons (box and glyph at their dp) and the avatar's initials. Display figures (`[data-balance]`, `[data-figure]`) grow a third at most, as Android 14's nonlinear scaling treats large type, so a five-digit balance stays on the screen.
- A length that must follow the text is written in `lh`, or times `--text-zoom` (the transfer amount's width in `ch`, the Aufteilen share field). A row's meta line is one `lh` high.
- M3E's text field grows round its text: the typed line gets its 16px above and below back as it grows, and the floating label sits on the outline and in the field's middle by its own line (`app/material.css`).
- A row of buttons, or a note beside a button, stays side by side while both fit and wraps when they don't: basis 0 and `min-width: fit-content`, never a fixed grid.
- What a sheet is for is said at the head of its scrolling body (`Panel`'s `intro`), never in the pinned header.

### Named Rules
**The Safe Choice Rule.** At every risk decision the safe action is the filled primary and the risky one the tonal button beside it. A destructive confirm the user asked for keeps its red button, with the safe one focused.

**The Safe Focus Rule.** A layer opens on the safe place (`safeFocusTarget`): what it names, else its first text field, else its close button, else the layer. Never a checkbox, switch, radio, link or action. A field marked `fine` takes focus only with a fine pointer, so a touch keyboard never covers a layer as it opens.

**The Pinned Way Out Rule.** A dialog's actions and a panel's closing action sit in a footer below the scrolling body and never scroll away — unless pinned header and footer together would take more than 45% of the screen (`useUnpinned`, the system's largest text): then the sheet scrolls as one, its way out at the end.

**The Inert Rule.** While a layer is open everything outside it is `inert`, so neither touch nor a screen reader's swipe walks out of it into the page behind; live regions (toasts, status lines) stay outside it and keep speaking.

**The Spring Rule.** Motion uses M3E's springs: spatial (position, size, shape) overshoots slightly; effects (colour, opacity) never do. `prefers-reduced-motion` is honoured.

**The Transitions (Android, only under `prefers-reduced-motion: no-preference`).** A place opens with a fade-through (opacity from 0, scale from 0.98, on the slow effects spring), keyed per place (`[data-place]`). The phone's search view clips open from the search bar's own shape (56dp, 28px round) to the full screen on the default spatial spring.

**The Backwards Fill Rule.** A page-level entrance animation uses `animation-fill-mode: backwards`, never `both` or `forwards`. A transform or opacity held after the animation ends creates a containing block and a stacking context, and the sheets and drawers that render in place inside it are trapped in the page instead of covering the screen.

### Printed Documents (Kontoauszug, Buchungsbeleg, Mitteilung)
Paper is a record for a third party: A4, fixed light `doc-*` values that no theme reaches, Google Sans Flex and Plex Mono, nothing under 8pt, body 9.5pt, a 20mm filing margin, no frames or filled bands, and the final balance between a 1px rule and a 3px double rule.

**The Record Rule.** Paper prints the bank's words as the bank sent them. Where the sheet leads with a name the app derived, "Name laut Bank" prints the whole string beside it. A balance the bank did not send is marked "(errechnet)".

**The Third-Party Rule.** Paper speaks in the third person and carries only what its reader needs. A Buchungsbeleg never shows the account's balance, a logo, a note or a receipt.

**The Two-Sign Rule.** On paper a debit is ink and a credit green, and both signs are written out, so a grey copy says the same. A balance carries only its minus.

## Do's and Don'ts

### Do:
- **Do** reach for tokens by name (`text-ink-2`, `bg-inset`, `var(--nav-bg)`) so the theme and Material You resolve themselves.
- **Do** put the look in `app/material.css` and only what a phone needs in `app/android.css` behind `data-platform="android"`.
- **Do** route every amount through `<Money>` and every IBAN through `.iban`.
- **Do** keep the text to 12, 14, 16, 18 and 22 plus the display figures (48 for the balance, 32 to 36 for a lead).
- **Do** use the two heading treatments: 18/500 ink for a section, 14/500 variant ink for a subheader.
- **Do** keep the bookings visible on an account page's first screen; put charts and summaries behind a tap.
- **Do** give charts colours by rank (top six, rest grey), green for income and navy-slate for spending.
- **Do** give every new icon an `ms` name from Material Symbols Rounded and add it to the subset.
- **Do** use the spaced Gedankenstrich (" – ") and German quotes („…“) in interface strings.

### Don't:
- **Don't** colour a debit red, or a credit card's balance.
- **Don't** use amber for anything but Vorgemerkt, or orange as text.
- **Don't** let a value colour, a chart slot, a plate or the AI mark's violet follow Material You.
- **Don't** use 600 or 700, or positive tracking on a figure.
- **Don't** put a card, a shadow or a hairline grid on the page to group a section (Einstellungen's grouped list excepted).
- **Don't** float a FAB over the phone's bookings or add a fourth place to the navigation.
- **Don't** bring back an outlined secondary button.
- **Don't** fill a chart area with a gradient.
- **Don't** hold a page-level animation's end state (`forwards` or `both`).
- **Don't** let the icons scale with the system's text size, or fill any icon but the current place.
- **Don't** let a theme reach paper.
- **Don't** use any bank's logo or name as the app's own identity.
