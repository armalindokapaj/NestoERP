> **Chat:** Nesto — adapting the 7F "Tirana Vertical" design
> **File:** `docs/ui/UI-03-vertical-look.md`
> **About:** What was taken from tirana.7fstudio.com, how each piece maps onto Nesto's tokens and primitives, what was deliberately not copied, and what is still open.
> **Last updated:** 2026-11-09

# UI-03 — The "Vertical" look

Nesto's version-1 look restated in the design language of
[Tirana Vertical](https://tirana.7fstudio.com/) (7F studio): cool paper, ink
rules, a condensed display face, italic serif standfirsts and small mono
labels. Everything lands through the existing tokens, so the product repaints
without page-by-page work.

Evidence: `docs/ui/evidence/UI-03-light.png`, `UI-03-dark.png` (real
primitives, rendered locally) and `UI-03-shell-light.png`,
`UI-03-shell-dark.png` (the real navigation in a mock of the shell; the
active row is forced for the picture).

## 1. What the reference is made of

Measured from the live page (computed styles), not estimated.

| Layer | Reference | Notes |
| --- | --- | --- |
| Ground | `#F5F6F7` paper, `#FFFFFF` surfaces | Light only; no dark scheme |
| Ink | `#0F141A` text and rules, `#3A424C` secondary, `#6F7782` muted | |
| Lines | ink at 10% and 20%; a full-ink 1px rule under the masthead and every section head | |
| Accent | `#B0251F` red, used for one full stop, links and the focus ring | |
| Status | built `#1E6A4E`, rising `#B06F12`, approved `#2D5A8A`, proposed `#7E6CC0`, revoked `#8C3A33` | 8px square dot, 2px radius |
| Display | Archivo variable, width axis 62–74, weight 500–600, tracking −0.02 to −0.035em | Outlined numerals: weight 300, 1.2px stroke |
| Standfirst | Newsreader italic, weight 300 | Inside a heading (`<i>`) and under it |
| Body | IBM Plex Sans 15/23, controls 12.5/500 | |
| Labels | IBM Plex Mono 10.5px, 500, uppercase, tracking 0.10–0.14em | |
| Controls | Pills (999px), white with a 1px ink-10% ring; active segment is an ink pill that slides | 34px high |
| Cards | 10px radius; shadow `0 0 0 1px ink/6%, 0 18px 40px -18px ink/35%, 0 40px 80px -40px ink/25%` | Shadow pulled under the card |
| Overlays | Menu 14px radius with 9px rows; detail sheet 24px, frosted (`blur(24px) saturate(1.4)`) | |
| Motion | `cubic-bezier(.25,.46,.45,.94)` for colour, `cubic-bezier(.16,1,.3,1)` for movement; entrance = 10px rise + 8px blur over 0.9s | Honours reduced motion |
| Layout | 1320px column; numbered sections (`01 Title *standfirst*`), chapter openers, sticky filter bar | |

## 2. Tokens (`styles/tokens.css`)

| Token | Was | Now (light / dark) |
| --- | --- | --- |
| `canvas` | `#f5f3ee` warm | `#f5f6f7` / `#0b0d10` |
| `fg` | `#16140f` | `#0f141a` / `#eceef1` |
| `fg-muted` | `#57514a` | `#3a424c` / `#a9b0ba` |
| `fg-subtle` | `#655e53` | `#59616c` / `#8b939e` |
| `border`, `border-strong` | warm greys | `#dfe2e5`, `#c8ccd1` / `#232830`, `#363d47` |
| `control-border` | `#857c6c` | `#757d87` / `#6f7884` |
| `primary` (light) | `#16140f` | `#0f141a` |
| `success` / `warning` / `info` / `danger` (light fills) | brighter | `#1e6a4e` / `#b06f12` / `#2d5a8a` / `#b0251f` |
| `shadow-card` | `0 2px 8px` | `0 14px 30px -22px` |
| `shadow-menu`, `shadow-dialog` | soft blurs | ink hairline + under-pulled drop |
| `radius-xl`, `radius-card` | 12px | 10px |
| `radius-overlay` | 12px | 14px |
| `ease` | `(.2,.8,.2,1)` | `(.25,.46,.45,.94)`, plus `ease-out` `(.16,1,.3,1)` |
| `motion-rise` | 600ms | 900ms, with an 8px blur |

`fg-subtle` is darker than the reference's `#6F7782`: Nesto holds metadata to
4.5:1 on every ground, hover and selected included, and the reference colour
does not clear that. The dark scheme is derived — the reference has none.

## 3. Type (`lib/fonts`, `styles/globals.css`)

| Role | Was | Now | Spent by |
| --- | --- | --- | --- |
| Sans | Manrope | IBM Plex Sans (variable) | body, controls |
| Mono | Geist Mono | IBM Plex Mono 400/500/600 | `nesto-eyebrow`, table headings, badges |
| Serif | Instrument Serif | Newsreader (variable, italic) | `nesto-standfirst`, the italic word in a heading |
| Display | — (the serif did this) | Archivo (variable width) | `font-display` |

All four are SIL OFL and bundled from Fontsource 5.3.0, Latin subset, like the
faces they replace. `font-display` sets width 68, weight 500 and −0.02em; every
former `font-serif` heading and figure now uses it.

Body text now names the face directly. Version 1 used to name it through a
theme variable that resolved on `<html>`, where next/font had not declared it,
so running text silently fell back to the system font.

## 4. Vocabulary added (`styles/globals.css`)

| Class | What it draws |
| --- | --- |
| `font-display` | Condensed title or figure |
| `nesto-standfirst` | Italic serif line under (or inside) a title |
| `nesto-rule` | The 1px ink rule that closes a title block |
| `nesto-numeral` | Outlined section number; decoration, `aria-hidden` |
| `nesto-status-dot` | 8px square status marker, `currentColor` |

Section head, as the reference draws it:

```tsx
<div className="flex items-end gap-5 nesto-rule pb-4">
  <span aria-hidden="true" className="nesto-numeral text-[5.25rem]">01</span>
  <h2 className="font-display text-display">
    Projects <em className="nesto-standfirst text-[0.62em]">where they stand</em>
  </h2>
</div>
```

## 5. Primitives changed

| Primitive | Change |
| --- | --- |
| `PageHeaderFrame` | Titles in `font-display`; page and module descriptions as a standfirst |
| `TableHeaderCell` | Mono, uppercase, 0.1em |
| `Badge` | Mono, uppercase, 0.06em |
| `TabsTrigger` | Active underline is ink, not gold |
| `NestoLogo` | Wordmark in Archivo at its wide setting |
| Sidebar (company and platform admin) | Rows are mono uppercase labels with neutral icons; the active row is a filled pill (ink in light, gold in dark) with no edge marker; group labels are muted, not gold; the frame's lines are quiet and the header closes on the top bar's ink rule; the workspace name is set in the display face, uppercase |
| Top bar | The bottom rule is ink; + Create is an ink pill; the company switcher is a white pill with a hairline; search, bell and collapse are round |
| Dashboard header | The bottom rule is ink |
| Dashboard heading | `Company *overview*`: display + italic serif in gold |

## 6. Deliberately not copied

- **The red accent.** Nesto keeps gold: focus ring, links, the selected row,
  the italic word in the dashboard heading.
- **Their content and compositions**: the skyline drawings, the fanned photo
  deck, the 3D city, the tower sheets, photographs and copy. The page reserves
  its design, layout, drawings and text; what Nesto takes is the general
  language (open-source typefaces, a neutral palette, hairlines, pills), drawn
  on Nesto's own components.
- **Pill text inputs.** Fields stay at 8px: a form has textareas and long
  values, which a pill does not hold.

## 7. Open

- **Version 2 (`NESTO_DESIGN_SYSTEM=2`)** gets the new typefaces only. Its
  palette is pinned to the UI-02 §6.1 table by
  `tests/unit/a11y/contrast.test.ts`, and it collapses display and serif type
  to the sans inside the app shell. Bringing version 2 onto this look means
  amending UI-02.
- **Signed-in screens were not viewed.** The local run had no database, so the
  check was the shared primitives, the landing page and the token tests. Worth
  a pass on the dashboard, a table-heavy module and a record page.
- **Segmented pills and numbered section heads** exist as vocabulary (§4) but
  no page uses them yet; context tabs are still underlined.
- **Native splash and icon** (`capacitor.config.ts`, `native:assets`) still
  use `#15171c`.
- `docs/a11y/contrast.md` and the UI-02 route register still describe the old
  values and the `font-serif` signal.
