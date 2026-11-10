> **Chat:** Nesto — adapting the 7F "Tirana Vertical" design
> **File:** `docs/ui/UI-03-vertical-look.md`
> **About:** Theme 2 — what was taken from tirana.7fstudio.com, how it sits beside Theme 1 as a selectable look, where each piece lives in the code, what was removed (UI-02), and what is still open.
> **Last updated:** 2026-11-10

# UI-03 — Theme 2, the "Vertical" look

Nesto has two looks. **Theme 1** is the original: warm ivory, gold, serif
titles. **Theme 2** is drawn in the design language of
[Tirana Vertical](https://tirana.7fstudio.com/) (7F studio): cool paper, ink
rules, a condensed display face, italic serif standfirsts and small mono
labels. Each has a light and a dark colour scheme.

Evidence: `docs/ui/evidence/UI-03-themes-light.png`, `UI-03-themes-dark.png`
— Theme 1 on the left, Theme 2 on the right, the real navigation and
primitives in a mock of the shell.

## 1. How the choice works

| | |
| --- | --- |
| Where | Settings → Appearance → **Theme** (Theme 1 / Theme 2) |
| Default | Theme 1. Nobody changes look until they pick Theme 2 |
| Stored | Cookie `nesto.look`, per browser, one year — like light/dark |
| Rendered | `<html data-look="2">` from the server, so there is no flash; Theme 1 renders no attribute |
| In code | "look", because "theme" already means the colour scheme: `lib/layout/look-state.ts`, `look-server.ts`, `styles/look-2.css`, the `look2:` variant |

Theme 1 is unchanged. Compared against `main` on the mock shell (light and
dark) and the landing page, it is pixel-identical, and it downloads none of
Theme 2's fonts.

## 2. What the reference is made of

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

## 3. Tokens (`styles/look-2.css`)

An overlay: every rule is scoped to `:root[data-look="2"]` and restates
variables `styles/tokens.css` already declares.

| Token | Theme 1 | Theme 2 (light / dark) |
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
| `ease` | `(.2,.8,.2,1)` | `(.25,.46,.45,.94)` |

`fg-subtle` is darker than the reference's `#6F7782`: Nesto holds metadata to
4.5:1 on every ground, hover and selected included, and the reference colour
does not clear that. The dark scheme is derived — the reference has none.
Every pair is measured in both themes and both schemes by
`tests/unit/a11y/contrast.test.ts`.

## 4. Type (`lib/fonts`, `styles/look-2.css`, `styles/globals.css`)

| Role | Theme 1 | Theme 2 | Spent by |
| --- | --- | --- | --- |
| Sans | Manrope | IBM Plex Sans (variable) | body, controls |
| Mono | Geist Mono | IBM Plex Mono 400/500/600 | `nesto-eyebrow`, table headings, badges, sidebar rows |
| Serif | Instrument Serif | Newsreader (variable, italic) | `nesto-standfirst`, the italic word in a heading |
| Display | — (the serif does this) | Archivo (variable width) | `font-display` |

All are SIL OFL and bundled from Fontsource 5.3.0, Latin subset. Theme 2's
four are declared without preload, so they are fetched only inside Theme 2.
`look-2.css` points the product's three font variables at Theme 2's faces;
every Theme 1 serif heading carries `look2:font-display`.

Theme 2 names its body face directly. Theme 1 names it through a theme
variable that resolves on `<html>`, where next/font has not declared it, so
Theme 1's running text is the system font — as it was before this work.

Vocabulary added, used with the variant (`look2:font-display`):

| Class | What it draws |
| --- | --- |
| `font-display` | Condensed title or figure |
| `nesto-standfirst` | Italic serif line under a title |
| `nesto-rule` | The 1px ink rule that closes a title block |
| `nesto-numeral` | Outlined section number; decoration, `aria-hidden` |
| `nesto-status-dot` | 8px square status marker, `currentColor` |

## 5. What changes on the components in Theme 2

| Where | Change |
| --- | --- |
| Sidebar (company and platform admin) | Rows are mono uppercase labels with neutral icons; the active row is a filled pill (ink in light, gold in dark) with no edge marker; group labels are muted, not gold; the frame's lines are quiet and the header closes on the top bar's ink rule; the workspace name is in the display face, uppercase |
| Top bar | The bottom rule is ink; + Create is an ink pill; the company switcher is a white pill with a hairline; search, bell and collapse are round |
| `PageHeaderFrame` | Titles in `font-display`; page and module descriptions as a standfirst |
| `TableHeaderCell` | Mono, 0.1em |
| `Badge` | Mono, uppercase, 0.06em |
| `TabsTrigger` | Active underline is ink, not gold |
| `NestoLogo` | Wordmark in Archivo at its wide setting |
| Dashboard header | Ink rule; `Company *overview*` as display + italic serif in gold |

## 6. Deliberately not copied

- **The red accent.** Gold stays the accent in both themes.
- **Their content and compositions**: the skyline drawings, the fanned photo
  deck, the 3D city, the tower sheets, photographs and copy. The page reserves
  its design, layout, drawings and text; what Nesto takes is the general
  language (open-source typefaces, a neutral palette, hairlines, pills), drawn
  on Nesto's own components.
- **Pill text inputs.** Fields stay at 8px: a form has textareas and long
  values, which a pill does not hold.

## 7. What was removed: UI-02 ("design version 2")

Theme 2 replaces the flag-gated version 2. Removed with it:

- `styles/tokens-v2.css`, the `ds2:` variant and every `ds2:` class;
- `NESTO_DESIGN_SYSTEM` and `NESTO_UI_RULER`, the `nesto.ds`, `nesto.density`
  and `nesto.ruler` cookies, and the developer-only Classic / New switch;
- Compact density and the page ruler, with the section registry, "On this
  page" links, back-to-section restore, published sticky heights, the tab-row
  overflow fade and the UI-02 route register;
- their unit and e2e tests.

Where version 1 and version 2 behaved differently, version 1's behaviour is
what remains — with one exception: forgot-password, reset-password and
verify-recovery-email keep version 2's focused layout, because version 1's
pages there used classes the stylesheet does not define.

## 8. Open

- **Signed-in screens were not viewed.** There was no database in the
  environment this was built in, so both themes were checked on a mock of the
  shell, the landing page and the token tests. Worth a pass on the dashboard,
  a table-heavy module, a record page and Settings → Appearance.
- **The type checker could not finish cleanly here** (the Prisma client could
  not be generated). Its errors on this branch match `main`'s, file for file
  and code for code; CI should confirm.
- **Long Albanian module names** truncate sooner in Theme 2's mono capitals
  than in Theme 1's sans.
- **Segmented pills and numbered section heads** exist as vocabulary (§4) but
  no page uses them yet.
- **Comments** in about fifteen files still mention version 2 or
  `tokens-v2.css`; `docs/ui/UI-02-*` and `docs/a11y/contrast.md` describe the
  removed design and the old values.
- **Native splash and icon** still use `#15171c` in both themes.
