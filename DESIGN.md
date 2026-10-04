---
name: Sooskasse-FinTS
description: German online banking over FinTS, on your own machine. A private branch for one customer.
colors:
  paper: "#f4f6f9"
  surface: "#ffffff"
  inset: "#edf0f4"
  raised: "#ffffff"
  ink: "#1b1f24"
  ink-2: "#4f5761"
  ink-3: "#5f6b78"
  line: "#dfe5ec"
  line-strong: "#c3cdd9"
  field-line: "#8391a0"
  field-bg: "#ffffff"
  headline: "#0a2c5e"
  bar: "#0a2c5e"
  bar-ink: "#ffffff"
  bar-ink-2: "#b9c8dc"
  bar-line: "rgb(255 255 255 / 0.28)"
  stage: "#0a2c5e"
  stage-ink: "#ffffff"
  stage-ink-2: "#c4d2e4"
  stage-line: "rgb(255 255 255 / 0.28)"
  accent: "#0864ad"
  accent-hover: "#06589a"
  accent-press: "#044a85"
  accent-ink: "#ffffff"
  accent-soft: "#e8f1f9"
  focus: "#3a7fb8"
  emphasis: "#ee6a1f"
  green: "#0c7336"
  green-soft: "#eaf4ee"
  red: "#c8102e"
  red-soft: "#fcecee"
  red-ink: "#ffffff"
  amber: "#8a6410"
  amber-soft: "#fff4dc"
  info: "#0074a3"
  info-soft: "#e9f4f8"
  scrim: "rgb(10 22 40 / 0.45)"
  chart-1: "#0053a4"
  chart-2: "#0ca4a0"
  chart-3: "#5f38a7"
  chart-4: "#e968a1"
  chart-5: "#3846b1"
  chart-6: "#049cd1"
  chart-rest: "#8a96a3"
  chart-in: "#2a9a5a"
  chart-out: "#30588f"
  chart-line: "#0864ad"
  chart-area: "rgb(8 100 173 / 0.08)"
  chart-grid: "#e8edf2"
  chart-axis: "#c3cdd9"
typography:
  display:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.015em"
    fontFeature: "'tnum', 'lnum'"
  headline:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.15
  title:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
  section:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  row:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.375
  button:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1
  label:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  caption:
    fontFamily: "Google Sans Flex, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.375
  mono:
    fontFamily: "IBM Plex Mono, Cascadia Mono, Consolas, ui-monospace, monospace"
    letterSpacing: "0.06em"
    fontFeature: "'tnum'"
rounded:
  field: "6px"
  chip: "8px"
  card: "12px"
  sheet: "16px"
  pill: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-press}"
  button-secondary:
    textColor: "{colors.accent}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.accent-soft}"
  button-tertiary:
    textColor: "{colors.accent}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-quiet:
    textColor: "{colors.ink-2}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
  button-stage-primary:
    backgroundColor: "{colors.stage-ink}"
    textColor: "{colors.stage}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-stage:
    textColor: "{colors.stage-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.red}"
    textColor: "{colors.red-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    size: "32px"
  input:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "48px"
  chip-filter:
    textColor: "{colors.accent}"
    typography: "{typography.button}"
    rounded: "{rounded.chip}"
    padding: "0 12px"
    height: "36px"
  chip-filter-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  tag-pending:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "24px"
  tag-positive:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "24px"
  tag-negative:
    backgroundColor: "{colors.red-soft}"
    textColor: "{colors.red}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "24px"
  tag-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "24px"
  tag-neutral:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "24px"
  tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  sheet:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "24px"
  masthead:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.bar-ink}"
    height: "60px"
    padding: "0 24px"
  institute-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "52px"
    padding: "0 24px"
  stage:
    backgroundColor: "{colors.stage}"
    textColor: "{colors.stage-ink}"
    padding: "20px 24px 64px"
  tab-pill-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  segmented:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.pill}"
    padding: "4px"
  segmented-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  bottom-bar-action:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    size: "52px"
---

# Design System: Sooskasse-FinTS

## Overview

**Creative North Star: "The Private Branch"**

Sooskasse-FinTS looks like the online banking its users already know: a navy
masthead, a navy stage band that greets you by name, and white tiles on a
quiet blue-grey page. It is rebuilt for one customer, on their own machine. It
is a branch that opens for one person. Nothing on the walls sells anything,
every figure is the bank's own, and the counter is tidy. The feel is
**trustworthy, plain and precise**. Trust comes from familiarity and
exactness, not from ornament.

Density is that of a good bank start page. At the desktop shell's 900×600
minimum, the account tiles are on screen without scrolling. There is still
room enough that a long Verwendungszweck reads like prose. Google Sans Flex
sets everything, and amounts use tabular lining figures, so a column of
bookings lines up on its decimal comma like a printed Kontoauszug. Colour is
rationed:

- navy is identity
- Signal Blue is the one thing you can press
- green, red, amber and orange each own exactly one meaning

The look is the modernised Atruvia online-banking language. It is the
owner's current choice and the default. Other looks may be explored, but only
as alternatives for the owner to pick, never swapped in. The system borrows a
language, never a bank's branding: the connected bank's logo appears only in
the white institute bar, under the app's own "€" mark. The protocol stays out
of the interface. FinTS segment codes and the structured tags inside a
Verwendungszweck never reach the screen. A capability shows up as an action
that is present or absent.

**Key Characteristics:**
- Three tiers on top: navy masthead, white institute bar, navy stage. Below them, white tiles lap 48px over the stage's lower edge.
- One interactive hue (Signal Blue). Each value colour owns one meaning.
- Pill buttons, sentence-case labels, semibold rather than bold.
- Tiles lifted by one soft shadow, never framed.
- Tabular figures and a real minus on every amount. Monospace only for what is read character by character.
- The dark theme is the same bank at night: navy-black, never grey.
- Motion is short and soft (150–250ms, one ease-out curve), and none of it is needed to read the screen.

## Colors

A rationed palette: navy for identity, one blue for action, and four value
colours that each mean exactly one thing.

### Primary
- **Night Navy** (#0a2c5e; `bar`, `stage`, `headline`): the masthead, the stage band, drawer header bands, the footer, and every headline on white (page titles on the login screens, tile titles, dialog titles). It is identity, never interaction. In the desktop shell, `bar` and `bar-ink` must equal `BAR_COLORS` in `electron/main.cjs`, because Windows draws its caption buttons in those colours right next to the bar.

### Secondary
- **Signal Blue** (#0864ad; `accent`): the one interactive colour. It covers buttons, links, the active tab's 3px rule, selected chips, checked boxes and switches, and the phone bar's Überweisen disc. Hover deepens it to #06589a (`accent-hover`) and press to #044a85 (`accent-press`). Text on it is white (`accent-ink`).
- **Signal Wash** (#e8f1f9; `accent-soft`): the hover and selected tint for outline buttons, chips and menu rows. Also the disc behind empty-state illustrations and dialog pictograms.
- **Focus Blue** (#3a7fb8; `focus`): the focus ring and nothing else. It is lighter than Signal Blue, so focus reads as its own state, and it holds 3:1 against the inset and every soft tint a control can sit on.

### Tertiary
- **Marker Orange** (#ee6a1f; `emphasis`): a mark, never text. It is used for the unread dot, the glyph and 3px edge of a warning, and the dot inside an emphasis tag ("Status unklar", "Betrag gestiegen").

### Value Colours
- **Credit Green** (#0c7336 on #eaf4ee): a credit booking, a confirmation, a successful outcome.
- **Soll Red** (#c8102e on #fcecee): a negative balance or an error. Never a debit.
- **Vorgemerkt Amber** (#8a6410 on #fff4dc): pending, not yet booked. Nothing else.
- **Info Cyan** (#0074a3 on #e9f4f8): neutral status, such as "Gerät gemerkt" and info notices. One step deeper than its cyan, so tag text clears 4.5:1 on its own tint.

### Neutral
- **Blue-Grey Paper** (#f4f6f9; `paper`): the page ground the tiles float on.
- **Tile White** (#ffffff; `surface`, `raised`, `field-bg`): tiles, sheets, drawers, menus and fields.
- **Inset Grey** (#edf0f4; `inset`): wells inside a tile. Tile footers, the segmented track, read-only fields, skeletons, quiet hovers.
- **Ink** (#1b1f24; `ink`): primary text, and debit amounts.
- **Slate Ink** (#4f5761; `ink-2`): secondary text, field labels, inactive tabs.
- **Quiet Ink** (#5f6b78; `ink-3`): dates, day headers, a booking's second line, hints. It still holds 4.5:1 on the inset it sits on, not only on white.
- **Hairline** (#dfe5ec; `line`) and **Strong Line** (#c3cdd9; `line-strong`): one hairline between list rows; the stronger line for static chips and chart axes.
- **Field Edge** (#8391a0; `field-line`): the boundary of a form control. It clears 3:1 (WCAG 1.4.11) because it is what tells you a field is a field.
- **Bar Ink** (#ffffff) with **Mist** (#b9c8dc on the bar, #c4d2e4 on the stage): text and secondary text on navy. Dividers on navy are white at 28%.
- **Scrim** (rgb(10 22 40 / 0.45)): behind modal sheets.

### Chart Palette
Categories take colours **by rank** within a chart: the top six get colours,
the rest are grey (`chart-rest`). The slots are an order, not a mapping. They
were validated so that adjacent slots stay apart under protan and deutan
simulation (worst ΔE 19.1 light, 14.1 dark). Lightness alternates dark and
light down the order, and every slot clears 3:1 on the tile. The set
deliberately avoids green, red, amber and orange, so a bar never reads as a
credit, an error, a pending booking or a mark.

For Einnahmen and Ausgaben:

- Income is Credit Green's chart sibling (`chart-in`).
- Spending is a navy-slate (`chart-out`), never red, because spending is not an error.
- The Kontoverlauf is a Signal Blue line over a flat 8% area. Never a gradient.

### Dark Theme: "the same bank at night"
Even the darkest plane keeps the blue in it. The tokens keep their names; only
the values change on `<html data-theme="dark">`:

| Token | Dark value | Note |
|---|---|---|
| `paper` / `surface` / `inset` / `raised` | #061423 / #0a1b2d / #0e2236 / #102740 | Floating surfaces get lighter, not shadowed. |
| `ink` / `ink-2` / `ink-3` | #e3e9ef / #a9b6c4 / #8d9bab | `headline` becomes ink (#e3e9ef). |
| `bar` / `stage` | #08192b / #0b2945 | The bar sits darker than the page, so it reads as the window's edge. |
| `accent` / `accent-ink` | #3ba4ef / #04121f | The same blue lifted to clear contrast; its ink flips to near-black. |
| `green` / `red` / `amber` / `info` | #54c279 / #fc6274 / #e0b155 / #4fb3dc | Each on a deep tint of itself. |
| `focus` / `emphasis` | #4fa3e0 / #f2813f | |

### Named Rules
**The One Signal Rule.** Signal Blue is the only interactive colour. Anything blue can be pressed, and nothing that can be pressed is any other hue. The two sanctioned exceptions are the white lead pill on the navy stage and the red button that confirms a destructive action.

**The Owned Colours Rule.** Green is a credit or a confirmation. Red is a negative balance or an error, never a debit: a debit is ordinary spending and stays ink. Amber means "vorgemerkt" and nothing else, so a warning uses the inset grey with an orange edge instead. Orange is a mark, never text.

**The Tokens Only Rule.** Tailwind's default palette is switched off (`--color-*: initial`), so `red-500` does not even compile. Every colour is a token. Literal white and black exist only for literal things: a logo plate, a QR code.

## Typography

**Interface Font:** Google Sans Flex (with Segoe UI, system-ui, sans-serif). Variable weight and optical size, latin-ext subset.
**Mono Font:** IBM Plex Mono (with Cascadia Mono, Consolas, ui-monospace)
**Print Font:** Barlow. It is frozen for the printed Kontoauszug and Buchungsbeleg. Barlow Condensed survives only in generated bank monograms.

**Character:** Google Sans Flex is open, round-shouldered and calm. A long
Verwendungszweck reads like prose rather than like a form, and its
optical-size axis draws a 52px balance with display proportions and a 13px
caption with text proportions from one file. Plex Mono is the clerk's hand:
it appears only where a person checks characters against another document.
Google Sans Flex is a binding owner choice for now.

### Hierarchy
- **Display** (700, 52px, line-height 1, −0.015em, tabular): the balance in the account hero, in Night Navy, or Soll Red when negative. The cents are set at half size in 600. It drops to 40px when the tile is narrower than 520px. The same weight sets the session countdown (40px), the transfer review amount (34px) and the amount in a booking's detail drawer (32px).
- **Headline** (700, 36px at ≥1100px, 32px at ≥640px, 28px on phones; line-height 1.15): the page title on the stage, in stage ink. On the login screens ("Bank wählen", "Anmelden") the same title is set in Night Navy.
- **Title** (700, 22px, 1.25): dialog titles, with a 15px Slate Ink description beneath.
- **Section** (700, 17px, 1.3, Night Navy): the title of a tile or a group. Drawer titles use the same size in bar ink.
- **Body** (400, 15px, 1.5): running text. Form controls use 16px, so a phone never zooms into a focused field.
- **Row** (600, 15px): the counterparty's name on a booking row, and its amount.
- **Button** (600; 14px at md, 15px at lg, 13.5px at sm, 13px at xs; line-height 1): every pill, tab and chip label.
- **Label** (600, 13px, 1.35, Slate Ink or Quiet Ink): field labels, stat labels, eyebrows above a figure. Always sentence case.
- **Caption** (400, 13px or 12.5px, Quiet Ink): a booking's second line, dates, hints, tile subtitles.

### Named Rules
**The Kontoauszug Column Rule.** Every amount goes through `<Money>`. It uses tabular lining figures and a real minus (U+2212), never a hyphen, so a column of bookings lines up on its decimal comma. Dates, counts and countdowns take `.tnum` too.

**The Semibold Rule.** 600 is for what you press or read as a label. 700 is only for what names a thing (page, dialog and tile titles) and for figures. Google Sans Flex at 700 thickens into a slab at 13–15px, and a row of bold pills out-shouts the headline it serves.

**The Sentence Case Rule.** Labels are sentence case and never letterspaced. A label's job is to be found, not to shout. Uppercase lives only in the printed documents' section heads, where it still means something.

**The Character-by-Character Rule.** IBAN, BIC, BLZ and references are set in IBM Plex Mono. An IBAN gets 0.06em tracking and never wraps, because half an IBAN on each of two lines cannot be checked.

## Layout

The window is one column of stacked bands, top to bottom:

1. **Masthead**: Night Navy, 60px (56px on phones). In the desktop shell it takes exactly the height of the Windows caption overlay (`env(titlebar-area-height)`), so the caption buttons and the bar are one band at any zoom.
2. **Institute bar**: white with a hairline under it, 52px (48px on phones).
3. **The page scroller**:
   - It opens with the **stage**: a compact navy band, about 140px on desktop, with 64px of padding below the title row.
   - The **main column** follows: `max-width: 1280px`, centred, 16px gutters (24px from 640px). It is pulled up 48px, so the first row of tiles laps over the stage's lower edge.

The masthead's content is not width-capped. The institute bar's row and the
page column share the 1280px column, so the bank's logo and the page title
share an edge.

**Grid.** From the `desk` breakpoint (68.75rem, 1100px) the overview runs two
columns: `minmax(0, 2fr)` and `minmax(300px, 1fr)`, 24px apart, with the side
column sticky. Below that breakpoint the same blocks stack in one column with
16px gaps (24px from 640px). Inside tiles, **container queries** decide
layout by the tile's own width, not the window's. For example, the balance
figures move beside the balance at a tile width of 640px.

**Rhythm.** Spacing follows Tailwind's 4px scale. Most gaps are 8, 12, 16 or
24px.

- Tile headers pad 16px, or 20px from 640px.
- List rows pad 16px or 20px horizontally and 12–14px vertically. A booking row is at least 64px tall.
- The account hero pads 20px, or 32px on wider screens.

**Breakpoints.** 640px (`sm`) and 1100px (`desk`), plus tile-level container
queries at 520px and 640px.

**Phone (<640px):**

- The section tabs leave the institute bar for a 64px bottom bar, plus the safe area. Its middle slot is a raised 52px Signal Blue disc for Überweisen.
- Centred dialogs arrive as bottom sheets.
- The stage's quick actions become a 2×2 grid of 44px pills.

**Desktop shell.**

- The minimum window is 900×600.
- Controls inside the masthead cap at `--band-ctl` (40px). They shrink with page zoom, never below the 24px target size.
- Right-hand edges of navy bars pad past the OS caption buttons (`.bar-caption-safe`).

### Named Rules
**The Fold Rule.** At the desktop shell's 900×600 minimum, the first row of account tiles is visible without scrolling. The stage stays compact, and its four quick actions stay on one line beside the title (below 1100px they drop to 36px pills without glyphs).

**The Shared Edge Rule.** The page column, the institute bar's row and the stage's content share one 1280px column and one gutter, so the logo, the title and the first tile align.

## Elevation & Depth

Surfaces are **lifted, never framed**. A tile separates from the blue-grey
paper by one soft, navy-tinted shadow, never by a border. Inside a tile,
structure comes from spacing, weight and one hairline per list, never from a
second frame. Floating layers (sheets, drawers, menus, popovers, toasts) take
a deeper pop shadow. In the dark theme nothing casts a shadow, because it
would be invisible. A surface lifts by being lighter than the paper, plus the
faintest 1px edge.

### Shadow Vocabulary
- **Tile** (`box-shadow: 0 1px 2px rgb(10 30 60 / 0.05), 0 4px 12px rgb(10 30 60 / 0.07)`): every tile at rest. Dark: `0 0 0 1px rgb(255 255 255 / 0.06)`.
- **Tile hover** (`box-shadow: 0 2px 4px rgb(10 30 60 / 0.06), 0 10px 24px rgb(10 30 60 / 0.12)` plus `translateY(-1px)`): only where the whole tile is the button, and only on devices with a real hover. Dark: the edge rises to 12% white.
- **Pop** (`box-shadow: 0 8px 20px rgb(10 30 60 / 0.16), 0 28px 56px -16px rgb(10 30 60 / 0.28)`): sheets, drawers, menus, popovers, toasts. Dark: `0 0 0 1px rgb(255 255 255 / 0.08), 0 24px 48px rgb(0 0 0 / 0.55)`.
- **Sticky** (`box-shadow: 0 6px 16px -8px rgb(10 30 60 / 0.18)`): a header that has started to stick over scrolling content.

### Named Rules
**The Lifted, Never Framed Rule.** A block is a `.panel` tile: 12px corners and one soft shadow. Never put a framed card inside a framed card, and never draw a border around a tile.

**The Night Edge Rule.** In the dark theme, depth comes from tone (`paper` → `surface` → `raised` get lighter), not from shadow. The only shadow-like mark is a 1px white edge at 6–12%.

## Shapes

The form language is soft rectangles under round controls. There is one
radius per job, and it climbs with the size of the thing:

| Radius | Used for |
|---|---|
| 5px | checkboxes |
| 6px | fields, tags, skeleton bars |
| 8px | filter chips, inline alerts, menu items |
| 12px | tiles, menus, popovers |
| 16px | dialogs and sheets (top corners only when it is a phone bottom sheet) |
| pill | every button, icon button, tab-inside-a-tile, segmented control, count badge and switch |

Borders:

- **Hairline:** 1px between list rows.
- **Fields:** a 1px Field Edge.
- **Secondary buttons:** a 2px Signal Blue outline.
- **Buttons on navy:** a 1.5px white-at-28% outline.

Icons are drawn on a 24px grid as round-capped line art: 1.8px stroke at
18px by default, 2–2.1px for chevrons and close marks. The "€" plate is a
rounded 8px square with the euro sign cut out in the bar's own navy.

## Components

### Buttons
Calm and unmistakable: every button looks pressable and says what it does, and none of them shouts.

- **Shape:** full pill (9999px). Four sizes:

  | Size | Height | Side padding |
  |---|---|---|
  | lg | 48px | 24px |
  | md | 44px | 20px |
  | sm | 36px | 16px |
  | xs | 30px | 12px |

- **Primary:** filled Signal Blue, white label, 2px transparent border so it lines up with outlined neighbours. Hover goes to `accent-hover`, press to `accent-press`. Used once per decision.
- **Secondary (the default):** 2px Signal Blue outline with a blue label. Signal Wash on hover, 18% blue on press.
- **Tertiary:** a blue label only, washed on hover. **Quiet:** a Slate Ink label that turns ink on an inset hover.
- **On navy:**
  - **Bar** (masthead): a 1.5px white-at-28% outline, capped to the band height.
  - **Stage:** a white outline.
  - **Stage primary:** filled white with a navy label. This is the one lead action on the stage (Überweisen).
- **Danger:** filled Soll Red. Only for confirming something destructive.
- **States:** disabled at 45% opacity. Busy swaps the left icon for a spinner, keeps the label and sets `aria-busy`. Transitions run 150ms.
- **Icon buttons:** round, 32px or 40px. The `aria-label` is mandatory and doubles as the hover tooltip. Pressed means wash plus blue glyph.

### Chips
- **Filter chip:** 36px tall, 8px corners, a 1px Signal Blue edge, a blue 14px semibold label. Selected adds the wash **and a check glyph**: the check, not the tint, is what says "on" without colour. A chip that opens a menu shows a chevron instead.
- **Value chip:** a recent payee, or a source note like "Aus GiroCode übernommen". Pressable ones look like filter chips. Static ones take a Strong Line edge and a Slate Ink label. Removable ones attach a 32px close segment.

### Tags
Status words on a row or heading, such as "Vorgemerkt", "Echtzeit" or "Gerät
gemerkt". They are not interactive.

- **Shape:** 24px tall (20px small), 6px corners, 12.5px semibold.
- **Colour:** the tint of a value colour with that colour's ink (neutral, info, positive, negative, pending).
- **Emphasis tags:** ink text with an orange dot, because orange is never text.
- **Count badges:** 20px pills in 12px bold tabular figures.

### Cards / Containers (Tiles)
- **Corner Style:** 12px (`rounded.card`).
- **Background:** Tile White on Blue-Grey Paper.
- **Shadow Strategy:** the Tile shadow at rest; Tile hover only for whole-tile buttons (see Elevation & Depth).
- **Border:** none. One hairline between rows of a list. A tile's footer sits on Inset Grey under a hairline.
- **Internal Padding:** 16px, or 20px from 640px. The header row holds a Section title, an optional 13px Quiet Ink subtitle, and right-aligned actions.

### Inputs / Fields
- **Style:**
  - 48px tall, 6px corners, a 1px Field Edge, white ground (Inset Grey in dark), 16px ink text.
  - 14px side padding, or 40px with a leading glyph.
  - The label sits above: 13px semibold Slate Ink, with "(optional)" in Quiet Ink. A 13px Quiet Ink hint sits below.
- **Hover:** the edge darkens to Quiet Ink.
- **Focus:** the global double ring: a 2px outline in Focus Blue at a 2px offset. On navy the ring is drawn in bar ink. Inside a clipped full-bleed row it becomes an inset 2px ring.
- **Error:** the edge turns Soll Red, and a semibold red message with a warning triangle appears under the control, linked by `aria-describedby`.
- **Disabled / Read-only:** Inset Grey ground, Strong Line edge, Quiet Ink text.
- **Select** uses the same box, with a 16px chevron.
- **Checkbox:** 20px with 5px corners, filled Signal Blue when checked.
- **Switch:** a 40×24px pill track with an 18px white thumb, Signal Blue when on.

### Tabs and Segmented Controls
- **Underline tabs** (the institute bar): 15px semibold, Slate Ink, turning ink when active. A 3px Signal Blue rule with rounded top corners sits on the bar's own bottom edge. The row scrolls sideways rather than wrapping.
- **Pill tabs** (inside a tile): 36px pills. The selected one is filled Signal Blue.
- **Segmented:** an Inset Grey pill track with 4px padding. The selected thumb is white with a 1.5px inset Signal Blue edge and a blue label. In dark, the thumb is lifted with ink instead and keeps an ink label.

### Navigation
- **Masthead:**
  - On the left: the "€" plate (32px) and the wordmark "Sooskasse-FinTS" (18px bold, bar ink, one colour).
  - On the right: a cluster of line icons, each labelled with its name, the way a German bank's start page labels its header: Suche, Mitteilungen, Beträge ausblenden, Darstellung, profile.
  - Each item is a 40px pill "navlink". Its glyph is in Mist and turns bar ink on a 12% white hover.
  - Labels drop out as the window narrows. The unread state is an orange dot ringed in navy.
- **Institute bar:** the bank's logo (on a white plate in light; bare, or inverted when dark, in the dark theme), its name in 14.5px semibold, and "BLZ …" in Quiet Ink. Then a vertical hairline, then the section tabs (Übersicht, Analyse, Verträge & Abos). An info tag "Gerät gemerkt" sits at the far right.
- **Phone bottom bar:** 64px plus the safe area, white with a hairline. It holds three sections, a centred 52px Signal Blue disc for Überweisen with a 4px surface ring, and "Mehr". The current item gets a 3px Signal Blue rule at the top.

### Overlays
- **Dialog:**
  - Raised white with 16px corners and the Pop shadow.
  - Widths 440, 540 or 680px. Arrives in 220ms (fade, 12px rise, 0.985 scale). On phones it becomes a bottom sheet that slides up in 250ms.
  - Attention dialogs open with an 88px navy header band around a 48px pictogram disc.
  - Actions sit in an end-aligned row (centred under a navy band). On phones they stack in reverse order, so the last action sits on top.
- **Drawer:** from the right, 440px or 560px wide, 240ms. Its header is a navy band at masthead height, carrying a 17px bold title and the close button.
- **Menu / Popover:**
  - Raised with 12px corners, 6px inner padding, the Pop shadow, 150ms pop-in.
  - Items are at least 40px tall, with 8px corners and 15px text. Focus is shown by an inset ground plus an inset ring.
  - Layers render in place (never portalled), so they can never reach a printout.
- **Inline alert:** 8px corners, a tinted ground and a 3px inner left edge in the tone colour, with an 18px glyph.
  - Error: red on red tint.
  - Success: green on green tint.
  - Info: cyan on cyan tint.
  - Warning: the inset grey with an orange edge (amber is taken).

### Money
The signature primitive. Every amount on screen passes through it.

- **Figures:** tabular lining figures, a real minus, and an explicit "+" on credit bookings.
- **Colour follows the role, not the sign:** a negative balance is red, a debit booking is ink, a credit booking is green.
- **Large balances** split off the cents at half size.
- **"Beträge ausblenden"** replaces the figure with "•••••". The value is then absent from the DOM entirely (no title, no aria-label), so a screen share, a screenshot or the accessibility tree cannot leak it.

### Account Hero
The selected account's balance tile:

- **Top:** a 14px semibold label ("Kontostand · Girokonto"), then the Display balance and a 13px tabular date line.
- **Beside it** once the tile is 640px wide (stacked below otherwise): Verfügbar, Dispositionsrahmen, Vorgemerkt.
- **Footer:** Inset Grey, holding the holder and the IBAN. The country and bank half of the IBAN recedes, and the account tail stays full strength.

### Booking Row
- **Layout:** at least 64px tall, 16px or 20px side padding, one hairline below.
- **Avatar:** 40px. A verified company logo on a white plate, or a monogram. The same avatar appears wherever this counterparty does.
- **Text:** the name in Row type, then a 13px Quiet Ink line: purpose summary · category glyph and name.
- **Amount:** right-aligned in Row type (credit green with "+", debit ink with "−"), with an optional 12.5px note such as "Buchung 06.10.".
- **Pending entries** live in their own Vorgemerkt panel, marked by a 36px Vorgemerkt Amber disc.

### Empty and Error States
- **Illustration:** a 120×96 line drawing on a Signal Wash disc. Strokes are 2.4px, in Signal Blue for the subject and Quiet Ink for detail. It explains rather than decorates.
- **Text:** a 16px bold title, then 14px Slate Ink at most 46ch wide, then an optional secondary button.
- **Error states** say the reason the way the bank or the app put it, and offer "Erneut versuchen".
- **Loading skeletons** are shaped like the rows they stand in for, with a 1.4s shimmer.

## Do's and Don'ts

### Do:
- **Do** reach for tokens by name (`bg-surface`, `text-ink-2`, `bg-accent`, `rounded-[var(--radius-card)]`). The dark theme then resolves itself through `data-theme`.
- **Do** build blocks from `<Tile>` / `.panel` (12px corners and the Tile shadow), and separate list rows with one `line` hairline.
- **Do** route every amount through `<Money>` (tabular figures, U+2212 minus, role-based colour, privacy mask), and every IBAN through the `.iban` mono style, which never wraps.
- **Do** keep labels sentence case at 600, and reserve 700 for titles and figures.
- **Do** give every icon-only control an `aria-label`. It doubles as its tooltip.
- **Do** keep the double focus ring visible: 2px Focus Blue at a 2px offset, bar ink on navy, inset inside clipped rows.
- **Do** keep motion between 150ms and 250ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`. Lift tiles only on hover-capable devices. Honour `prefers-reduced-motion`.
- **Do** keep phones thumb-first: 44px controls, the section tabs in the bottom bar, dialogs as bottom sheets.
- **Do** give charts colours by rank (top six, rest grey), Credit Green for income and navy-slate for spending.
- **Do** put the connected bank's logo only in the institute bar, under the app's own mark.

### Don't:
- **Don't** colour anything Signal Blue that cannot be pressed, and don't make a pressable thing any other hue (except the stage's white lead pill and a destructive red confirm).
- **Don't** colour a debit red. Spending is not an error.
- **Don't** use amber for a warning. Amber means "vorgemerkt"; a warning is inset grey plus an orange edge.
- **Don't** set orange as text. It is a dot, an edge or a glyph.
- **Don't** frame a card inside a card or draw a border around a tile.
- **Don't** letterspace labels or set them in capitals.
- **Don't** use Tailwind's default palette (`red-500`, `slate-200`). It is switched off on purpose.
- **Don't** show FinTS segment codes or a Verwendungszweck's structured tags in the interface.
- **Don't** fill a chart area with a gradient. The Kontoverlauf area is flat.
- **Don't** change the print styles (`.doc`, Barlow, the 30mm label rail). The paper is frozen while the screen moves on.
- **Don't** use any bank's or Atruvia's logo, wordmark or name as the app's own identity. The app borrows a design language, not a brand.
