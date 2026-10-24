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
  emphasis: "#ee6a1f"
  brand-plate: "#0a2c5e"
  plus-gold: "#f2c14e"
  gemini-blue: "#4285f4"
  gemini-purple: "#9b72cb"
  gemini-rose: "#d96570"
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

Girovo is a bank branch that opens for one person. Nothing on the walls sells anything, every figure is the bank's own, and the counter is tidy. The look is Material 3 Expressive, drawn by the real `@m3e/web` components (wrapped in `components/ui.tsx`), in Google Sans Flex, on Material You's wallpaper roles on an Android phone and on Girovo's own blue scheme everywhere else (`app/material.css`).

The phone is the system's reference. Its home has one field at the head that searches every booking, action and setting and, on Android, answers a question about the bookings. Below it the balance is set flat, then a row of chips, then the bookings, then three places at the foot. The page is flat and list-first; tone, weight and space carry the hierarchy, and the colours that carry a value never follow the wallpaper.

The desktop (from 640px) followed the phone on 2026-10-24 (owner's choice): the Material Symbols, the type, the transfer's two parts, the tabbed Umsatzdetails, the brand-field Anmeldung and the search-first Übersicht ("Suche oben", picked from three mocks in `.impeccable/mocks/decision/desktop/`). It keeps the 96dp rail and, on its other pages, the 1280px column with the page's name in the top bar. What stays Android only — the wallpaper's colours and chart tones, the transitions, the phone's sheets and touch targets — is `IS_ANDROID` in code and `html[data-platform="android"]` in CSS.

**Key Characteristics:**
- Search-first home: a 56dp search bar is the only tinted shape at the top.
- A flat 48/500 balance with tight tracking; no balance card at any width.
- Three text sizes (12, 14, 16), one section step (18), one screen step (22), and display figures.
- Weight 500 for emphasis; rank is weight and tone before size.
- Owned value colours: green, red, amber and orange each mean one thing.
- Three places, no FAB on the phone; Material Symbols Rounded, the current place filled.

## Colors

Material's colour roles carry surfaces, ink, lines and the one interactive colour; Girovo's tokens (`--paper`, `--ink`, `--accent`, …) map onto them in `app/material.css`. Girovo's scheme sits at zero specificity so Material You's runtime roles win on the phone. The frontmatter holds the light values; the dark theme keeps the names.

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
- **Marker Orange** (`emphasis`): a mark, never text. The unread dot, a warning's glyph, an emphasis tag's dot.

### Neutral
- **Page** (`md-surface`; `paper`, `bar`): the page and the top bar, one plane. On Android the bar takes Container once the page scrolls under it.
- **Container Low** (`md-surface-container-low`): sheets, drawers, menus, popovers.
- **Container** (`md-surface-container`; `nav-bg`): the navigation bar, Einstellungen's grouped rows, the Gemini answer's ground.
- **Container High** (`md-surface-container-high`; `inset`, `dialog-bg`): the search bar, the avatar disc, wells, skeletons, basic dialogs.
- **On Surface** (`ink`): text, debit amounts, everything that reports.
- **On Surface Variant** (`ink-2`): meta lines, day headers and subheaders on the phone, labels.
- **Outline / Outline Variant**: a field's outline; a chip's edge and the hairline inside floating layers.
- **Inverse Surface**: the snackbar.

### Brand and Partner Colours (literal)
- **Brand Navy** (`brand-plate`): the G€ plate only.
- **Plus Gold** (`plus-gold`): the G€ in gold on the navy plate, Girovo Plus's mark and every door to Plus.
- **Gemini** (`gemini-blue`, `gemini-purple`, `gemini-rose`): a thin 115° wash over Container (26/20/18%) wherever Gemini Nano answers, and the filled spark. Text on it keeps the row's ink.

### Chart Palette
Categories take `chart-1` to `chart-6` **by rank** within a chart; the rest are `chart-rest`. The slots are an order, not a mapping. Income is `chart-in`, spending `chart-out` (never red). The Kontoverlauf is a staircase line over a flat 12% area, never a gradient.

- **Everywhere but Android:** the fixed slots in the frontmatter, chosen to avoid green, red, amber and orange and to stay apart under protan and deutan simulation.
- **Android (owner, 2026-10-23):** the wallpaper's tones by rank: primary, tertiary, primary at 62%, secondary, tertiary at 62%, secondary at 62% (each mixed in oklab toward the surface); the rest is `md-outline`. Colour only groups here: the label and amount beside every bar carry the meaning.

### Named Rules
**The Owned Colours Rule.** Green is a credit or a confirmation. Red is a negative balance or an error, never a debit: a debit is ink. A credit card's balance stays ink (a card is known by its Kontoart, `isCardAccount`). Amber means Vorgemerkt and nothing else; a warning is an orange glyph. Orange is never text.

**The Fixed Values Rule.** The value colours (including `chart-in` and `chart-out`), the brand plate, Plus Gold and Gemini's colours never take a wallpaper colour. Surfaces, ink, lines, the interactive colour and, on Android only, the six category slots and the rest follow Material You.

**The Tokens Only Rule.** Tailwind's default palette is switched off; every colour is a token. Literal colours exist only for literal things: the plates, a QR or TAN plate, the chipTAN flicker field.

## Typography

**Interface Font:** Google Sans Flex (with Segoe UI, system-ui, sans-serif)
**Mono Font:** IBM Plex Mono (with Cascadia Mono, Consolas, ui-monospace)
**Icon Font:** Material Symbols Rounded, a self-hosted 14 KB subset (`public/fonts/material-symbols-rounded.woff2`, `font-display: block`, declared in `app/material.css`). It sets icons only, never words.

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
**The Symbol Rule.** Every app icon is a Material Symbol (`Icon`'s `ms` name) in a box of exactly 1em, sized in px (dp on the phone): `text-size-adjust: none`, so the system's larger text grows the words, never the glyph. `filled` sets FILL 1, used only for the current place in the navigation (24px). Gemini's spark and the avatar glyphs are pictures and stay drawn. The icon's own `display` sits in the base layer, so `hidden` and the Darstellung's glyph switch decide whether it shows.

**The Two Headings Rule.** A section is 18/500 in ink; a subheader is 14/500 in the variant ink. Einstellungen keeps its subheaders in the primary (owner, 2026-10-20). There is no third treatment.

**The Medium Weight Rule.** Emphasis is 500, never 600 or 700. Rank comes from weight and tone before size.

**The Tight Figures Rule.** No positive tracking on figures. An amount is −0.01em; a display figure (`[data-balance]`, `[data-figure]`) is −0.025em. Body text keeps the face's own spacing (0).

**The Kontoauszug Column Rule.** Every amount goes through `<Money>`: tabular lining figures, a real minus (U+2212), and the privacy mask ("••• €") under Beträge ausblenden. Dates and counts take `.tnum`.

**The Character-by-Character Rule.** IBAN, BIC, BLZ and references are in Plex Mono. An IBAN gets 0.06em tracking and never wraps.

**The Sentence Case Rule.** Labels are sentence case, never capitals, on screen and on paper.

## Layout

**Phone (below 640px).** One column with 16px gutters; sections reach the screen's edges and are held apart by space. The top bar reaches under the status bar. Touch targets are at least 48dp. The bottom navigation bar is 64dp plus the gesture bar and is a row of the page's column, so nothing scrolls under it.

**The Übersicht, top to bottom:** the search bar (56dp, fully round, 8dp under the status bar, holding the search glyph, "Umsätze suchen oder fragen", the Gemini spark where Nano can answer, and the 32dp avatar with the unread dot); the account name with its chevron and, at the row's end, the eye for Beträge ausblenden; the balance with Verfügbar under it, then on its own line the date or, for today's figure, its freshness ("Stand 13:57 Uhr", the time of the read), and the sparkline (96×36 in a 112×48 target) at its baseline, which opens the details in place; one sideways-scrolling chip row (Vorgemerkt, Eingänge, Ausgänge, Kategorie, Monat, then the period and the export); then day headers and rows. The account chevron opens a bottom sheet with the account list in its rows layout (`[data-rows]`, with the `rows:` and `narrow:` variants in `app/globals.css`).

**The Übersicht on the desktop (640px and up), "Suche oben":** the phone's, in one 960px column centred beside the scrollbar (the mock's 880 plus room for the whole chip row on one line). The search bar spans the column in the title bar (48px there, since the Electron caption overlay holds the bar at 60px; Strg K inside it, the avatar at its end) and only it stops dragging the window; the bar gives way to the caption buttons on a narrow window (`SEARCH_EDGES`). Under the balance a quiet line of three figures (`MonthFigures`): Eingänge and Ausgänge for the month's loaded days ("1.–24. Oktober"), and Demnächst fällig over 30 days, labels 14 in the variant ink over values 16/500, with no tile. The chip row ends with the period chip and two icon buttons, refresh and export, and wraps instead of scrolling sideways when a window is too narrow for it. What stood beside the bookings has a place of its own: the Vorgemerkt behind their chip, the Mitteilungen behind the avatar (its dot and a row of the Sitzung panel, as on the phone), what is due and the forecast in Zahlungen, the month in Analyse; "/" opens the search like Strg K.

**Zahlungen, top to bottom:** Überweisen (filled) and Geld anfordern (tonal), equal width; "GiroCode scannen" (Android); Vorlagen; Zuletzt bezahlt; the forecast; "Verträge & Abos"; the bank's orders.

**Überweisung, "Betrag zuerst" (every platform; a full-screen dialog on the phone, the centred dialog on the desktop):** two parts and the review, with a three-segment bar (4px, the primary over the progress track) in the header: Betrag, An wen?, Prüfen. Part one holds the account, the amount typed into the figure (decimal keyboard), Verfügbar and any funds warning under it, Ausführung and Termin; its footer is "Abbrechen" with "Weiter: An wen?". Part two holds the payee section and the Verwendungszweck; its footer is "Zurück" with "Weiter zur Prüfung". Every check stays the form's; a problem in the amount part sends the user back to it. After the review the title names the step; there is no stepper. With a fine pointer, part two starts in the name.

**Umsatzdetails, "Registerkarten" (every platform):** on the phone a full-page drawer whose body takes the page surface, on the desktop the side drawer, the tabs running to its edges. A left-aligned header (the 56dp disc, the name at 22/500, the booking text and time at 14, the amount as display detail, the state tags, the actions) over primary tabs: Details, Notiz & Belege, Kategorie.

**Anmeldung, "Markenfläche mit Blatt" (the phone, and a narrow browser window):** a primary-container field holds the language switch, the G€ plate (48, then 36 after the first step), "Girovo" at 28 (22 after) and, on the first step only, "Banking direkt mit deiner Bank – ohne jemanden dazwischen." The steps sit on a paper sheet with 28px top corners that rises 28px over the field, with a handle-shaped mark. Quick picks are logo tiles, four by two, on every platform.

**Anmeldung on the desktop (640px and up):** the field is the window's left column (`clamp(240px, 28vw, 400px)`, top to bottom, dragging the window) with the plate at 48, "Girovo" at 28, the brand line and the version at its foot; the paper sheet rises 28px over it from the right with 28px left corners. The sheet's top strip is the title bar (language, Darstellung, the update), on paper so the OS caption buttons match it. The side tile beside the form switches on the sheet's width (the `auth` container, 59rem), not the window's.

**Analyse:** Ausgaben leads as the display lead with its comparison line; the other figures are label and value rows (14 label, 16/500 value).

**Desktop (640px and up).** The navigation is the 96dp rail; the Übersicht is the 960px column above; every other page's column is 1280px wide with the top bar sharing its edge. A flat section reaches 20px out (its rows are inset 20px), so rows, chips and headings share the page's left edge.

### Named Rules
**The Reading Order Rule.** The DOM order is the narrow reading order. A wider layout places blocks with the grid, never with CSS `order`.

**The Phone's Page Rule.** On the phone's home the bookings are visible without scrolling. Whatever would push them down (summaries, the chart) goes behind a tap.

## Elevation & Depth

Flat by default. A container is told from the page by tone, not by edge or shadow. Shadow belongs only to what floats: menus, sheets, drawers, the snackbar (`level3`), Android's pull-to-refresh disc, the Anmeldung's sheet over its brand field (a soft upward shadow). On the desktop a white tile keeps a whisper of shadow (`shadow-tile`) by day and a 1px light edge by night. The full values are in the sidecar.

### Named Rules
**The Flat Page Rule.** A section on the page has no surface, corners, shadow or hairline between rows. The page has no container at all. The exception is Einstellungen (owner, 2026-10-20): Material 3 Expressive's grouped list, rows as tiles on Container, 2px seams, 20px outer corners, 4px inner ones.

**The Scroll Edge Rule.** A pinned header or footer inside a sheet is flat while everything fits; a 1px hairline appears only once content runs under it.

## Shapes

Material's corner scale (`--m3e-corner-*`). Fully round: the search bar, buttons at rest (they squeeze square while pressed and spring back), the avatar disc, the navigation pill. Small (8px): chips, the brand plate. Large (16px): tiles, the Gemini answer, the Anmeldung's bank tiles. Extra-large (28px): sheets, the Anmeldung's sheet, basic dialogs. Extra-small (4px): outlined fields, snackbars, a grouped row's inner corners. On a phone a multi-step flow is a full-screen dialog with no corners, and a bottom sheet has a 32×4 drag handle.

## Components

### Buttons
- **Primary** is M3E's filled button in the primary; **secondary** is the tonal button. There is no outlined secondary.
- **Quiet** is a text button in the variant ink; **danger** is filled in Soll Red, only for a destructive confirm the user asked for.
- **Connected groups** that span the phone's width (Termin: Sofort · An einem Datum · Regelmäßig) take 8px sides, and each segment is sized by its label and may shrink, so the group never runs past the screen.

### Search
The Übersicht's head (`Masthead.tsx` SearchBar) opens the search (`CommandPalette.tsx`), on the phone as Material's full-screen search view. On Android a question-like query hands over to "Frag deine Umsätze" in Analyse. On the other pages the search is an icon (a phone) or a pill (a wide window) in the top bar, and Strg K or "/" everywhere. The Umsätze have no search field of their own: a search handed over shows as a chip.

### Chips
M3E filter chips, 8px corners; a selected chip is the tonal wash. The Vorgemerkt chip carries an 8px amber dot and opens the pending sheet; Eingänge and Ausgänge toggle; Kategorie and Monat open menus.

### Booking Rows
A 40dp disc on Container High in the variant ink: the category glyph, or initials for a person. A merchant logo, when one is known, takes a white rounded tile instead. A Vormerkposten's disc is amber. Name and amount are row type; credits are green, debits ink. The meta line is the category and, on the phone, the payment method, whole or not at all; the bank's prose waits for the detail drawer. Rows are at least 64px.

### Tabs (Umsatzdetails)
Material's primary tabs, 48px, labels at 14/500: the variant ink at rest, the primary when selected, with a 3px indicator under the middle of the label and a 1px line under the row. Arrow keys move between tabs. A tab with something attached carries a 6px dot in the primary, and its name says so to a screen reader (sr-only text), never by the dot alone.

### Bank Tiles (Anmeldung)
On Android: 56px tall, 16px corners, white with a 1px inset hairline by day (banks draw their marks for white), the inset colour by night. The label under the tile is 12px on one line; a long name of two words takes two lines and never gets a hyphen.

### Day Headers
Subheader type on the page's own ground, sticky. A Buchungstag still ahead says "noch nicht gebucht" with a clock glyph, in the variant ink; amber stays Vorgemerkt's.

### Navigation
M3E's navigation bar on the phone, with three places: Übersicht · Zahlungen · Analyse (the internal tab id `contracts` is labelled Zahlungen). There is no FAB on the phone; Überweisen lives at the head of Zahlungen and in the search. From 640px M3E's nav items form the 96dp rail, Überweisen as a small primary-container FAB at its top, Einstellungen at its foot. On the phone Einstellungen and Mitteilungen are rows in the Sitzung panel behind the avatar, and the avatar carries the unread dot.

### Gemini Nano
Frag deine Umsätze and the Nano row in Einstellungen stand on Gemini's wash with its three-colour spark. Nano never states a figure; the app computes it.

### Girovo Plus
The navy plate with the G€ in Plus Gold. Every door to Plus is the same tonal button with the gold plate as its icon. A locked figure is never shown blurred or greyed.

### Named Rules
**The Safe Choice Rule.** At every risk decision the safe action is the filled primary and the risky one the tonal button beside it. A destructive confirm the user asked for keeps its red button, with the safe one focused.

**The Safe Focus Rule.** A layer opens on the safe place (`safeFocusTarget`): what it names, else its first text field, else its close button, else the layer. Never a checkbox, switch, radio, link or action. A field marked `fine` takes focus only with a fine pointer, so a touch keyboard never covers a layer as it opens.

**The Pinned Way Out Rule.** A dialog's actions and a panel's closing action sit in a footer below the scrolling body and never scroll away.

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
- **Do** keep the bookings visible on the phone's first screen; put charts and summaries behind a tap.
- **Do** give charts colours by rank (top six, rest grey), green for income and navy-slate for spending.
- **Do** give every new icon an `ms` name from Material Symbols Rounded and add it to the subset.
- **Do** use the spaced Gedankenstrich (" – ") and German quotes („…“) in interface strings.

### Don't:
- **Don't** colour a debit red, or a credit card's balance.
- **Don't** use amber for anything but Vorgemerkt, or orange as text.
- **Don't** let a value colour, a chart slot, a plate or Gemini's colours follow Material You.
- **Don't** use 600 or 700, or positive tracking on a figure.
- **Don't** put a card, a shadow or a hairline grid on the page to group a section (Einstellungen's grouped list excepted).
- **Don't** float a FAB over the phone's bookings or add a fourth place to the navigation.
- **Don't** bring back an outlined secondary button.
- **Don't** fill a chart area with a gradient.
- **Don't** hold a page-level animation's end state (`forwards` or `both`).
- **Don't** let the icons scale with the system's text size, or fill any icon but the current place.
- **Don't** let a theme reach paper.
- **Don't** use any bank's logo or name as the app's own identity.
