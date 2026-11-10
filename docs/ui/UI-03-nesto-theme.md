> **Chat:** Nesto — adapting the 7F "Tirana Vertical" design
> **File:** `docs/ui/UI-03-nesto-theme.md`
> **About:** The Nesto theme — the Tirana Vertical reference taken apart, the concept Nesto draws from it, how each of the reference's patterns lands on Nesto's screens, the icon system, Day and Night, what was removed (Theme 1, UI-02), and what comes next.
> **Last updated:** 2026-11-10 (the only theme; Day or Night)

# UI-03 — The Nesto theme

Nesto has one theme, the **Nesto theme**, drawn in the design language of
[Tirana Vertical](https://tirana.7fstudio.com/) (7F studio). It is a drawing
sheet more than an app. It uses cool paper, ink rules, condensed display
figures, italic serif standfirsts, mono labels, status drawn as architects
draw it, and IBM's Carbon icons. It comes in two colour schemes, **Day** and
**Night**.

Evidence (`docs/ui/evidence/`):

- `UI-03-nesto-desktop.png`: dashboard header, record header, metric
  figures, status marks and the project plates, by Day then at Night.
- `UI-03-nesto-desktop-detail.png`: a dialog, and the tables at Night.
- `UI-03-nesto-phone.png`: the hero and KPI figures, the record and metric
  figures, the plates two to a row, the More sheet and a docked sheet, by
  Day then at Night.
- `UI-03-nesto-icons.png`: the Carbon glyph behind each icon name.
- `UI-03-nesto-appearance.png`: the Nesto theme setting.

All of them are the real components in a mock of the shell.

## 1. Day or Night

| | |
| --- | --- |
| Where | Settings → Appearance → **Nesto theme**: Day / Night. Also the one-click sun/moon in the top bar, the More sheet and the account panel |
| Default | Day, whatever the operating system prefers. Night only when chosen |
| Stored | Cookie `nesto.theme` (`light` or `dark`), per browser, for one year. Anything else, an old `system` included, reads as Day |
| Rendered | `<html data-theme="light \| dark">` from the server, so there is no flash. `styles/tokens.css` is `color-scheme: light`, and `:root[data-theme="dark"]` turns it to dark, which every `light-dark()` token follows |
| In code | `lib/layout/theme-state.ts`, `components/settings/theme-preference.tsx` (`applyThemeChoice`), `components/layout/theme-toggle.tsx` |

**Theme 1 was removed** on 2026-11-10, with the look it was chosen by: the
`nesto.look` cookie, `<html data-look>`, the `look2:` variant,
`styles/look-2.css`, the Theme 1 / Theme 2 setting, the Lucide icons and the
Manrope, Geist Mono and Instrument Serif fonts. The Nesto theme's values now
live in `styles/tokens.css` and `styles/globals.css` directly, and every
former `look2:` class is a plain class. The fold was checked frame by frame:
the mock shell (desktop and phones, Day and Night, the More sheet and every
dialog) and the public site match what Theme 2 drew, apart from the More
sheet's Dark/Light row, which now reads Night/Day.

## 2. The reference, taken apart

### 2.1 Structure and positioning

The site is a portfolio of towers. It is laid out like a set of drawings: each
screen has a title block, numbered sheets and a legend. The structure matters
more than the surface, so these are the parts and where they sit.

| Pattern | What it is | Where it sits |
| --- | --- | --- |
| **Masthead** | Brand, then mono navigation, then a meta line, closed by one full-ink rule | Top, full width. The rule is the page's horizon |
| **Hero** | Giant condensed type. The second word is drawn in outline and indented, and a red square stands as the full stop | First thing under the masthead, left-aligned. The type is the image |
| **Hero figures** | Three or four display numbers over mono labels, each under its own hairline | Directly under the hero: the page's answer comes before its argument |
| **Numbered section head** | Outlined numeral, title, an italic standfirst, then a full-ink rule | Opens every section, with the number set before the title |
| **Chapter opener** | A section head with a small chart drawn to scale (heights and counts) beside it | Between groups of sections |
| **Deck (filter bar)** | Segmented pills, status chips with counts, a mono result count and a pill search | Sticky under the masthead while the gallery scrolls |
| **Plates** | Image cards with a glass status chip and a big figure. The caption reads "01 Name", an italic "by", then a hairline and meta with "SHEET →" | The gallery: 4 columns on desktop, 2 on a phone |
| **Sheet** | A frosted glass panel with a facts grid | Floats over the gallery; full screen on a phone, 8px off the edges with 20px corners |
| **Ranked list** | Rows led by outline numerals | Lower on the page, for "tallest" and "latest" |
| **Section dial** | A 62px ink circle with a scroll-progress ring that expands into section icons | Floats bottom right |
| **Legend** | Solid, hatched (5px at 45°), outline and dashed fills | Next to every drawing and on every status |

What this adds up to:

- **Answer first.** The figures sit above the gallery. Proof comes after.
- **Numbered, not boxed.** Order is shown by "01, 02, 03" and by ink rules.
  Cards are used only for things you pick up (plates).
- **Status is drawn, not coloured.** The legend's fills carry meaning without
  hue, the way a drawing set does.
- **Floating things are glass; everything else is paper.**

### 2.2 Measurements

These were measured from the live page's computed styles, not estimated.

| Layer | Reference | Notes |
| --- | --- | --- |
| Ground | `#F5F6F7` paper, `#FFFFFF` surfaces | Light only; there is no dark scheme |
| Ink | `#0F141A` text and rules, `#3A424C` secondary, `#6F7782` muted | |
| Lines | Ink at 10% and 20%; a full-ink 1px rule under the masthead and every section head | |
| Accent | `#B0251F` red, used for one full stop, links and the focus ring | |
| Status | built `#1E6A4E`, rising `#B06F12`, approved `#2D5A8A`, proposed `#7E6CC0`, revoked `#8C3A33` | 8px square dot, 2px radius |
| Display | Archivo variable, width axis 62–74, weight 500–600, tracking −0.02 to −0.035em | Outlined numerals: weight 300, 1.2px stroke |
| Standfirst | Newsreader italic, weight 300 | Both inside a heading (`<i>`) and under it |
| Body | IBM Plex Sans 15/23; controls 12.5/500 | |
| Labels | IBM Plex Mono 10.5px, weight 500, uppercase, tracking 0.10–0.14em | |
| Controls | Pills (999px), white with a 1px ink-10% ring. The active segment is an ink pill that slides | 34px high |
| Cards | 10px radius; shadow `0 0 0 1px ink/6%, 0 18px 40px -18px ink/35%, 0 40px 80px -40px ink/25%` | The shadow is pulled in under the card |
| Overlays | Menu: 14px radius, 9px rows. Detail sheet: 24px radius, frosted (`blur(24px) saturate(1.4)`) | |
| Icons | Custom, on a 20px grid; stroke 1.6–1.8, round caps | Their own drawings; not copied (§6) |
| Motion | `cubic-bezier(.25,.46,.45,.94)` for colour, `cubic-bezier(.16,1,.3,1)` for movement. Entrance is a 10px rise with an 8px blur over 0.9s | Honours reduced motion |
| Layout | 1320px column | |

### 2.3 The concept for Nesto

Nesto is an ERP for builders. Its users read drawings for a living, so the
reference's drawing-set language is not decoration for them: it is their
literacy. The theme follows eight rules.

1. **Figures first.** Every page with numbers leads with them, set in the
   display face over a mono label. This covers dashboard KPIs, a record's
   facts and a budget's metrics. The label explains the figure; the figure
   is the headline.
2. **Status is drawn.** Every status carries a legend mark before its label:
   solid, hatched, outline, dashed or crossed. Shape says what colour says.
   This is the reference's legend and a site drawing's convention, and it
   also means status never relies on colour alone.
3. **Ink rules, not boxes.** A title block, a set of figures and a table head
   close on a full-ink rule. Boxes are kept for things you pick up: plates,
   KPI cards, dialogs.
4. **Numbered sets.** A collection on screen, such as the dashboard's widgets
   or the project gallery, numbers its members "01, 02, 03" in mono before
   the title, as sheets in a set are numbered.
5. **Two voices and a ruler.** The condensed display face states things. The
   italic serif explains them. Mono labels, measures and indexes them. Plex
   Sans carries the work in between.
6. **Ink acts, gold marks.** The primary action is ink (gold in dark). Gold
   stays Nesto's accent and appears where the reference uses red: the full
   stop, the tick above a figure, the focus.
7. **Glass only for what floats.** Dialogs, drawers, menus, the phone's bar
   and its sheets are frosted. Pages are paper.
8. **Arrive from focus.** A page's title block rises 10px out of an 8px blur
   in 0.8s, on the reference's colour curve. Nothing else moves on load.
   Reduced motion turns it off.

## 3. Tokens (`styles/tokens.css`)

Day and Night are declared together with `light-dark()`, one line per token.

| Token | Day / Night |
| --- | --- |
| `canvas` | `#f5f6f7` / `#0b0d10` |
| `surface` | `#ffffff` / `#12151a` |
| `fg` | `#0f141a` / `#eceef1` |
| `fg-muted` | `#3a424c` / `#a9b0ba` |
| `fg-subtle` | `#59616c` / `#8b939e` |
| `border`, `border-strong` | `#dfe2e5`, `#c8ccd1` / `#232830`, `#363d47` |
| `control-border` | `#757d87` / `#6f7884` |
| `primary` | ink `#0f141a` / gold `#c9a961` |
| `accent` | gold `#8f6c2c` / `#c9a961` |
| `success` / `warning` / `info` / `danger` (fills) | `#1e6a4e` / `#b06f12` / `#2d5a8a` / `#b0251f` by Day |
| `shadow-card` | `0 14px 30px -22px`, pulled in under the card |
| `shadow-menu`, `shadow-dialog` | ink hairline + under-pulled drop |
| `radius-xl`, `radius-card` | 10px |
| `radius-overlay` | 14px |
| `ease` | `(.25,.46,.45,.94)` |
| `space-page-x` | 20px on a phone, 24px from `md`, 32px from `xl` |

`fg-subtle` is darker than the reference's `#6F7782`. Nesto holds metadata to
a 4.5:1 contrast ratio on every ground, including hover and selected, and the
reference colour does not reach that. The dark scheme is derived, because the
reference has none. Every pair is measured by Day and at Night by
`tests/unit/a11y/contrast.test.ts`.

## 4. Type and vocabulary (`lib/fonts`, `styles/globals.css`)

| Role | Face | Variable | Used by |
| --- | --- | --- | --- |
| Sans | IBM Plex Sans (variable) | `--font-nesto-sans` | body, controls |
| Mono | IBM Plex Mono 400/500/600 | `--font-nesto-mono` | `nesto-eyebrow`, labels, table headings, badges, sidebar rows, indexes |
| Serif | Newsreader (variable, italic) | `--font-nesto-serif` | `nesto-standfirst` |
| Display | Archivo (variable width) | `--font-nesto-display` | `font-display`, headings, figures |

All four are licensed SIL OFL and bundled from Fontsource 5.3.0, Latin
subset. Plex Sans and Archivo are preloaded, being on every first paint; the
mono and the serif swap in. Headings `h1`–`h3` take the display face from a
base-layer rule, so a heading that names its own face keeps it.
`font-display` also sets the tracking variable, so a named size beside it
(`text-page`) keeps the face's tracking.

Classes:

| Class | What it draws |
| --- | --- |
| `font-display` | A condensed title or figure |
| `nesto-standfirst` | The italic serif line under a title |
| `nesto-rule` | The 1px ink rule that closes a title block |
| `nesto-numeral` | An outlined section number; decoration, `aria-hidden` |
| `nesto-status-dot` | An 8px square status marker in `currentColor` |
| `animate-[nesto-rise-focus_…]` | The entrance: a rise out of blur (`globals.css`) |

Attributes, drawn by the rules at the end of `styles/globals.css`:

| Attribute | On | Draws |
| --- | --- | --- |
| `data-mark="solid \| hatch \| outline \| dashed \| cross"` | A status label | The legend mark before the label |
| `data-numbered` | A collection | Restarts the "01" count |
| `data-numbered-title` | The title of each member | "01", "02", … in mono before it |
| `data-metric-strip` | `MetricStrip` | Open figures on an ink rule instead of a card; two to a row on a phone |
| `data-kpi-card` | `KpiCard` | On a phone, an open figure under a hairline instead of a card |
| `data-plate` | `ProjectCard` | On a phone, drops the plate's "01" index |
| `data-phone-sheet="dock \| full"` | Docked and full-screen dialogs, `BottomSheet`, bottom drawers | On a phone, a sheet floating 8px off the edges |

The attributes replace classes where Tailwind's layers would lose: `.nesto-card`
sits in the utilities layer and would win over a class on the same element,
so these rules are unlayered.

## 5. The patterns on Nesto's screens

Everything below is a class on the component or a rule in `styles/globals.css`.

### 5.1 Pattern → Nesto

| Reference | Nesto | Where |
| --- | --- | --- |
| Masthead and its ink rule | Top bar on an ink rule. + Create is an ink pill and the company switcher a white pill | `components/layout/topbar.tsx` |
| Mono navigation | Sidebar rows in mono capitals with Carbon icons; the active row is an ink pill | `sidebar-nav.tsx` |
| Hero, outlined second word, square full stop | The dashboard's `Company overview.`: Archivo at width 62, from 4rem to 7.5rem. "overview" is outlined and indented with a gold square for the full stop, and the block rises from focus | `welcome-header.tsx`, admin `sections.tsx` |
| Hero figures | KPI cards lead with the figure (2.75rem, width 70) under the gold tick, over a mono label. The icon tile is gone | `kpi-card.tsx` |
| Facts under hairlines | A record header's facts (contract value, floors, completion, manager) form a grid of figures, each under its own hairline. On a phone they take the full width, two columns | `page-header.tsx` (`FACTS`) |
| Section head with standfirst and rule | Every page and module title: display face, italic standfirst, ink rule | `PageHeaderFrame` |
| Figures with labels | `MetricStrip` drops its box: a 2.5rem display figure under a mono label, cells side by side on an ink rule | `metric-strip.tsx`, `[data-metric-strip]` |
| Legend fills | Status marks on every `Badge` and project chip (§5.2) | `badge.tsx`, `project-status-badge.tsx` |
| Plates | Project cards become plates: 10px corners, no border, the reference's lifted shadow that deepens on hover over 700ms. The caption reads "01 Name", then an italic company line, then a hairline over the place | `project-card.tsx`, `projects-portfolio.tsx` |
| Glass status chip | On a plate, the project status chip is dark glass with its legend mark. In the record bar and compact rows it is a mono-capital pill | `project-card.tsx`, `project-status-badge.tsx` |
| Numbered sheets | Dashboard widgets and the project gallery are numbered sets | `dashboard-grid.tsx`, `dashboard-widget.tsx`, `projects-portfolio.tsx` |
| Ink rule under a head | Table heads in mono close on an ink rule | `table.tsx` |
| Segmented control | `Tabs`, context tabs and settings choices: a white pill track with an ink pill for the active choice | `tabs.tsx`, context tabs |
| Detail sheet | Dialogs are glass sheets with 24px corners. Drawers float 8px off the edges with 20px corners | `dialog.tsx`, `drawer.tsx` |
| Brand title | The sign-in panel's headline uses the hero setting | `brand-panel.tsx` |
| Entrance | Title blocks rise 10px out of an 8px blur | `page-header.tsx`, `welcome-header.tsx` |

### 5.2 Status marks

| Mark | Meaning | `Badge` tone | Project status |
| --- | --- | --- | --- |
| Solid | Built, done | `success` | Finished |
| Hatched | Under construction, needs attention | `warning` | Active |
| Outline | Approved, not started; in review | `info` | Pending |
| Dashed | Proposed, draft, archived | `default`, `neutral` | Archived |
| Crossed | Stopped, rejected, failed | `danger` | none |

The mark is an 8px square with a 1px border in the label's colour. A badge
that carries its own icon shows the icon instead of the mark.

### 5.3 Everywhere else

| Where | Change |
| --- | --- |
| Fields | Inputs, selects and textareas get 10px corners; the search field is a pill |
| Menus, select lists, popovers | 14px corners, 9px rows, quiet separators, mono group labels |
| Breadcrumbs, `Badge`, `TableHeaderCell` | Mono capitals |
| `Switch` | Ink when on |
| Tooltips | Pills |
| Account panel | Neutral icons |
| `NestoLogo` | Archivo at its wide setting |

### 5.4 Phone

The reference's narrow page was measured at 390px wide (through a frame
inside the live site): a 24px gutter; a 117px hero (Archivo at width 62,
weight 600, 0.8 line height) set under an italic kicker; figures at 30px over
mono labels; plates two to a row (165px, 12px apart across and 28px down)
without their index; the filter strip scrolling sideways; and the section
dial, a 62px ink circle 30px from the right and 40px from the bottom.

| Where | Change |
| --- | --- |
| Gutter | 20px instead of 16px, so the page and the top bar line up |
| Hero | As large as the longest word allows: `min(25vw − 10px, 7.5rem)`, which is 87px at 390px wide. The size is set by the longest Albanian word, "kompanisë.", which keeps 15px or more of room down to a 320px screen |
| Greeting | The reference's kicker: Newsreader italic at 19px |
| KPI cards | Open figures: no box, each under its own hairline with the gold tick standing on it, two to a row 24px apart (`[data-kpi-card]`) |
| Metric strip | Two figures to a row at 2rem, each under its own hairline, like a record's facts (`[data-metric-strip]`) |
| Record facts | Full width, two columns, each under its own hairline |
| Plates | Two to a row with portrait covers (3:4), 12px apart across and 28px down. Names run to two lines at 17px, and the "01" index is dropped as the reference drops it |
| Sheets | A docked dialog, a full-screen dialog, a `BottomSheet` and a bottom drawer float 8px off the edges and clear of the home indicator, with 20px corners all round (`[data-phone-sheet]`). A centred dialog stays centred, so an open keyboard never covers it |
| `BottomSheet` | The reference's glass, as dialogs have |
| More sheet | A floating glass panel with an ink rule under its title. The lists are open on the glass, with hairlines between rows and labels aligned with them; the current module is an ink row. The profile stays a card |
| Bottom bar | A 20px glass bar with a white edge and mono capital labels. The current destination is an ink pill (gold in dark); Create is an ink circle |
| Section pill (top right) | A white pill with a hairline, ink while its menu is open |
| Quick Create, Alerts and every touch popup | The reference's menu glass: 14px corners, lighter frost, hairline, deep pulled-in drop |

## 6. Icons (`components/icons`)

**Choice.** Every icon is one of IBM's
[Carbon](https://github.com/carbon-design-system/carbon/tree/main/packages/icons)
glyphs (Apache-2.0). The reference's icons are its own drawings, so Nesto
does not copy them. Carbon is the family drawn alongside IBM Plex, which is
the reference's body and label type. It shares Plex's grid and stroke: a
32-unit box with a 2-unit line, so 1px at 16px, like a drawn line. It has
flat terminals and engineered geometry, and it includes an industry
vocabulary: `helmet`, `delivery-truck`, `industry`, `enterprise`,
`inventory-management`, `task--approved`.

**How it works.**

- `components/icons/index.ts` is the product's only icon module, generated
  by `scripts/icons/generate.mjs`. Each of its 288 exports is
  `glyph(name, markup)` (`components/icons/glyph.tsx`): one `<svg>` on the
  32-unit grid, filled with the current colour, sized by `size` or a class.
- The names are the ones the code already imported (`Building2`, `HardHat`,
  `Loader2`, …), so call sites read the same. The types are `IconComponent`
  and `IconProps`.
- An icon is decorative unless it is given `aria-label`, in which case it is
  `role="img"`. It takes no stroke width: Carbon glyphs are filled.
- The spinner is a drafting arc: a quarter-open circle drawn with Carbon's
  line weight.
- No icon package ships: `lucide-react` is gone, and `@carbon/icons` is a dev
  dependency the generator copies glyphs from.

**The map.** `scripts/icons/icon-map.mjs` names the Carbon glyph behind each
name. The choices follow meaning, not shape:

| Icon | Carbon glyph |
| --- | --- |
| NestoProjects | `enterprise` (a tower) |
| HardHat | `helmet` |
| GanttChart | `roadmap` |
| Landmark (finance) | `finance` |
| Bell | `notification` |
| Award | `badge` |

**Adding an icon.**

1. Add its name and the Carbon name to `icon-map.mjs`.
2. Run `pnpm icons:generate`.
3. Import it from `@/components/icons`.

`tests/architecture/icons.test.ts` fails the build if anything imports an
icon package directly, or if the generated module loses its glyphs.

## 7. Deliberately not copied

- **The red accent.** Gold stays the accent, by Day and at Night. It takes red's
  places: the full stop, the tick, the focus.
- **Their content and compositions.** This covers the skyline drawings, the
  fanned photo deck, the 3D city, the tower sheets, their icons, photographs
  and copy. The site reserves its design, layout, drawings and text. Nesto
  takes the general language (open-source typefaces, a neutral palette,
  hairlines, pills, a drawing set's conventions) and draws it on Nesto's own
  components.
- **Pill text inputs.** Only the search field is a pill. Other fields have
  10px corners, because a form has textareas and long values that a pill
  does not hold.
- **The reference's 10% field ring.** Field borders keep the control-border
  colour, which reaches 3:1 against the ground; the reference's ring does
  not.
- **The single floating button on a phone.** The phone keeps its five-button
  bar rather than the reference's one round button, so Create and Alerts stay
  one tap away.

## 8. What was removed

**Theme 1** (2026-11-10): see §1.

**UI-02 ("design version 2")**, which the Nesto theme replaced. Removed with it:

- `styles/tokens-v2.css`, the `ds2:` variant and every `ds2:` class;
- `NESTO_DESIGN_SYSTEM` and `NESTO_UI_RULER`, the `nesto.ds`, `nesto.density`
  and `nesto.ruler` cookies, and the developer-only Classic / New switch;
- Compact density and the page ruler, along with the section registry, "On
  this page" links, back-to-section restore, published sticky heights, the
  tab-row overflow fade and the UI-02 route register;
- their unit and e2e tests.

Where version 1 and version 2 behaved differently, version 1's behaviour
remains, with one exception: forgot-password, reset-password and
verify-recovery-email keep version 2's focused layout, because version 1's
pages used classes the stylesheet does not define.

## 9. Next

**Still to build:**

- **The section dial.** A floating ink circle with a scroll-progress ring.
  On the reference it opens into a column of round buttons, each with a mono
  label pill beside it, and the current section is filled ink. In Nesto it
  would take the phone's section pill out of the top bar and into the thumb's
  reach. It has to sit with the bottom bar's Create button, so its placement
  needs designing.
- **Chapter openers with drawings to scale.** Module landing pages (Finance,
  Procurement) would open with a small chart drawn to scale beside the
  title: budget against committed against spent, or orders by stage.
- **The deck.** On list pages, status chips with counts and a mono result
  count beside the segmented pills and the search, sticky while the list
  scrolls.
- **Ranked lists.** "At risk" and "latest" lists led by outline numerals.

**Still to check:**

- **Signed-in screens.** These were not viewed, because there was no database
  in the environment this was built in. The theme was checked on a mock of
  the shell, the public pages and the token tests. The dashboard, a
  table-heavy module, a record page and Settings → Appearance need a pass.
- **The type checker** should run where the Prisma client can be generated.
  Here its errors match `main`'s, file for file and code for code.
- **Long Albanian labels.** They truncate sooner in mono capitals, most
  visibly in the phone's bottom bar and the sidebar.
- **Titles drawn as `<p>`.** A title written as a paragraph stays in Plex Sans
  unless it carries `font-display`.
- **Stale references.** Comments in about fifteen files still mention version
  2 or `tokens-v2.css`. `docs/ui/UI-02-*` and `docs/a11y/contrast.md`
  describe the removed design.
- **Native splash and icon.** These still use `#15171c`, by Day and at Night.
