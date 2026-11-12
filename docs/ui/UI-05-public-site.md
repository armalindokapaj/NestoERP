> **Chat:** Nesto UI/UX — navigation study
> **File:** docs/ui/UI-05-public-site.md
> **About:** Nesto's public site as built from the canvas: the Ribbon masthead, the section-cut homepage with "Try it here", sign in, Apply for a workspace, pricing in public and the restyled interior pages; every page a sheet of numbered sections with the index rail and the 0–100 ruler (§9) — what each draws, where the code lives, and what is still to do.
> **Last updated:** 2026-11-12 (lines, glass and the ruler, after getartcraft.com)

# UI-05 — The public site

The public site was redesigned on the canvas ("Public site" page) and is now
built from it. The owner's choices:

- **Masthead:** Theme 1, the Ribbon — the same idea as the app's own Ribbon.
- **Homepage:** concept C, "The section cut", with enough of concept B's
  "Try it here" window in between to let a visitor run a company through NESTO.
- **Sign up:** there is no self-service sign-up — a company's workspace is set
  up by NESTO — so "sign up" is **Apply for a workspace** (`/apply`).
- Sign in, Pricing, Security, Terms, Privacy, About, Contact, Questions,
  Platform and the Full View all move to the same drawing-set look.

Everything is in English and Albanian, in Day and Night, on desktop and phone.

## 1. The look in one paragraph

A drawing set, not a brochure. Ink rules (2px, `border-fg`) close every
masthead and page head. Display type is Archivo condensed; a heading ends on a
gold square instead of its full stop (`Dotted` in
`components/marketing/section.tsx`). Standfirsts are the serif italic.
Drawn pieces — drafting paper, hatched fills, the title block, the section
cut's slabs, outline lettering, the received stamp — are a handful of classes
in `styles/globals.css` under "The public site's drawn pieces"; everything else
is Tailwind on the product's own tokens.

Since 2026-11-12 (§9): lines instead of cards — square cells sharing 1px
lines, no gaps, shadows or rounded corners; glass where the page passes under
something; square buttons in mono capitals; every section numbered in a bar
that pins under the masthead; the index rail and the 0–100 ruler at the right.

## 2. The Ribbon masthead

`components/marketing/site-masthead.tsx`, mounted by
`app/(public)/(site)/layout.tsx`.

- **One row of cells divided by lines, in glass** (95% of the page and an 8px
  blur, on a layer behind the masthead): the logo; the tabs; from 1600px
  "Follow one Unit through NESTO"; the language; Day/Night; Sign in; and
  **Apply for a workspace** as the ink block at the end ("Apply" below xl).
- **Tabs:** Platform, Solutions, Modules, Pricing, Company, in mono capitals.
  Each is a disclosure button; the open one, or the one the page is in, is in
  ink. Its panel drops over the page as glass (72% and a 16px blur), groups in
  lines (big buttons above, a mono caption below) and, on three tabs, an ink
  callout. Escape, a click outside, a link or a new page closes it.
- **Structure** lives in `config/marketing.ts → siteRibbon`; words in the site
  copy under `ribbon`. The **Modules** tab is the module registry
  (`config/modules.ts`), named through the `modules` dictionary, so it can
  never list a module that does not exist. The "By role" group names roles
  through the `roles` dictionary; the role count is the registry's.
- **No prices in the masthead.** The layout renders on every page and must not
  read the database; the Pricing tab links to the live rates instead.
![Modules panel](evidence/UI-05-ribbon-modules.png)

### 2.3 On a phone

Logo, a short "Apply" as the ink block, and a menu cell that opens a
full-screen sheet — the tabs as square mono tabs, each panel as 3-across square
tiles, theme and language, and Sign in / Apply pinned at the foot.

### 2.4 Footer

The sitemap, closed by a title-block strip (©, category, sign-off, version).
"Request access" became "Apply for a workspace" → `/apply`.

## 3. The homepage

`app/(public)/(site)/page.tsx`, top to bottom.

### 3.1 The section cut

`components/marketing/home/section-cut.tsx` — NESTO drawn as a building: a
floor per department on one foundation, the project record. Each floor is a
toggle; the picked floor's sheet (line, three points, its modules) opens
beside the drawing. Floors and their modules are
`config/marketing.ts → sectionFloors`; words under `home.cut`.

### 3.2 Try it here

`components/marketing/landing/interactive-story.tsx` — the existing
interactive story, now inside an illustrative NESTO window: an address bar
(`meridian.nesto.build/units`), the app's Ribbon tabs with the slide's tab
marked, the slide, and the step bar. All the story's behaviour is kept:
shareable `/?story=…&step=…` links (which now scroll to the window), browser
Back through slides, arrow keys, the demos. A link to a slide from anywhere —
the masthead, the hero, the three kinds — re-mounts the story at that slide.

### 3.3 From the tender to the final account

The six lifecycle stages, each with a small building that rises as the
project does.

### 3.4 Three kinds of company

Developer, Contractor, Group; each opens its story.

### 3.5 The bill of quantities, in public

`lib/marketing/price-book.ts` turns the live price book
(`getPublicPricingConfig`) into rows: the Platform with what it includes, a
further company, project and people pack, and ROZARIS from its smallest class.
The launch offer is read from the active promotion. `PriceBook`
(`components/marketing/price-book.tsx`) draws them as a schedule.

**No figure is written into a page.** With no price book the schedule says so
and shows nothing. Euros are formatted with `numberText`, as the configurator
does, because Chrome has no Albanian number data and `Intl` would disagree
between server and browser.

### 3.6 Access

Four legend fills: role-derived, refused at the edge, checked again in the
page, on the record.

### 3.7 Break ground on your NESTO

The ink band: Apply, Sign in.

![Home, Day](evidence/UI-05-home-day.png)
![Try it here](evidence/UI-05-try-it-here.png)

## 4. Interior pages

The shared primitives carry the new look to every page at once:

- `PageIntro` — mono sheet name, a large title ending on the gold square, the
  serif standfirst, an ink rule.
- `Section` with `bar` — one of the page's numbered sections (§9); its eyebrow
  is the bar's name. `SectionHeader` is the title and lead under it; the bar
  carries the number.
- `CtaBand` — the ink band, the page's last section, its bar in ink; its
  primary is Apply for a workspace.
- `LegalDocument` (Terms, Privacy) — a dashed "not the contract" note, then
  each part a numbered section of its own. The FAQ's groups are too.
- Pricing and Security get more than the primitives — §7.
- `Container` is 1280px wide with the masthead's gutter, so every page lines
  up with the masthead.

The Full View keeps its own opening; its words moved from `home` to `tour` in
the site copy. Its own section navigator is gone: the index rail does that
job, with the short names it had (`fullViewCopy.nav`, through `Section index`).

## 5. Sign in

`components/layout/focused-page.tsx` and `components/layout/brand-panel.tsx`,
shared by sign in, recovery, reset, recovery-email confirmation and the
invitation.

- The brand panel is **dusk**: three towers lit floor by floor with a crane on
  the tallest (`components/layout/brand-skyline.tsx`), ink in both themes.
  "Every floor of your company, / one sign-in away." On a phone it shrinks to a
  band of skyline above the form.
- A top bar with a way home, Day/Night and the language — on every account page.
- The sign-in form is a title block: Username and Password cells (Show
  password on), Forgot password, a full-width Sign in. Field labels and the
  button's name are unchanged, so every e2e sign-in still finds them.
- Under it: "No account yet? Your company's administrator creates it. New to
  NESTO? **Apply for a workspace →**". No "keep me signed in" — sessions are
  a fixed working day and there is nothing behind such a box.

![Sign in, Night](evidence/UI-05-sign-in-night.png)

## 6. Apply for a workspace

`app/(public)/apply/` — bare like sign in, with its own header.

- Four steps: **Company** (name, country, city, kind, size), **You** (name,
  work email, phone — optional, role), **What you'll run** (departments,
  active projects, people who will sign in, when), **Review** (consent and
  what happens next).
- Beside it, the application as a **permit**: a title block that fills in as
  the visitor answers, with a **sample estimate** from the live price book
  (Platform base + projects beyond the included + people packs, before the
  offer). No price book, no estimate.
- Each step is checked against the server's own schema
  (`lib/marketing/apply-schema.ts`) before the next opens. Received: a stamp
  with the reference (`NST-2026-XXXXXX`), "Thank you, {name}." and the four
  steps that follow.
- `submitApplicationAction` (`lib/actions/apply.ts`) validates, drops the
  honeypot, rate-limits by address (`WORKSPACE_APPLICATION`, 5 an hour) and
  writes `[nesto:application]` with the reference to the server log — the same
  honest V0.1 as the contact form: **there is no mail transport or CRM yet.**
- `/apply` is a public route (`lib/permissions/route-access.ts`).

![Apply, a step](evidence/UI-05-apply-step.png)
![Apply, received](evidence/UI-05-apply-received.png)

## 7. Pricing and Security

- **Pricing** keeps the configurator first (Modular Pricing PRD §3), under a
  sheet header; after it come the bill of quantities (`#prices`, offer at
  `#offer`) — §3.5 — what's included, the questions and the proposal prompt.
- **Security** draws its measures as a legend (solid, hatch, outline, dash,
  gold, cross) and puts "What we do not claim" in a dashed box.

![Price book](evidence/UI-05-price-book.png)

## 8. Phone and languages

![Phone: menu in Day and Night, and the hero](evidence/UI-05-phone.png)
![Home in Albanian](evidence/UI-05-home-albanian.png)

## 9. Lines, glass and the ruler

After getartcraft.com, in Nesto's own type and gold (canvas: "Lines, glass and
the ruler"). Every page of the site is a sheet:

- **Numbered sections.** A section marked with `sectionMark` (or `Section bar`)
  opens with `SectionBar`: "02 / End to end" in mono, pinned under the masthead
  while the section is on screen (`.site-bar`, 60% of the section's ground and
  a 12px blur). The number is a CSS counter on `.site-sheet`, so it is always
  the page's own order. Sections are clipped sideways only (`overflow-x-clip`):
  `overflow: hidden` would keep the bar from pinning.
- **The index rail and the ruler** (`components/marketing/site-index.tsx`),
  from xl, fixed at the right with the page and footer kept clear of them
  (`xl:pr-[224px]`): the rail lists where you are large, the way back above it,
  "Sheet 02 / 06", and what is next; the ruler has a tick every point, a
  number every 5 and the gold line where you are. Both go somewhere on a click.
  They read the page's sections after each navigation; nothing lists them.
- **Below xl** a 2px gold line under the masthead says how far through the
  page you are, and each bar says which of how many it is (02 / 06).
- **Buttons are square everywhere** (`--nesto-radius-button: 0`). On the site
  their labels are 11px mono capitals and a large one is 48px with 24px sides;
  the secondary is a 40% ink line. The rule is outside the CSS layers so it
  wins over the size utilities, and never applies inside a drawing of the
  application (`site-app`: the story's window, the workspace preview). Tags
  and badges are square too.
- **Lines, not cards.** Grids are square cells sharing one line
  (`hairlineGrid`); the homepage's stages, kinds and access, and the pricing
  grids, are drawn that way, numbers in ink squares, tags as square mono tags.
- Reduced motion jumps instead of scrolling; a phone reads nothing under 12px.

![The homepage at the top: the rail lists every section](evidence/UI-05-sheet-home.png)
![In a section: its bar pinned, the rail and ruler](evidence/UI-05-sheet-section.png)
![A tab's panel dropped as glass](evidence/UI-05-sheet-ribbon-glass.png)
![The Full View: eleven sections, short names in the rail](evidence/UI-05-sheet-full-view.png)
![Phone: the gold line and the bar's count](evidence/UI-05-sheet-phone.png)

## 10. Tests

- `tests/unit/marketing/price-book.test.ts` — rows come from the price book,
  ROZARIS "from" its smallest class, the offer, the estimate, the format.
- `tests/unit/marketing/apply-schema.test.ts` — the schema, the steps cover
  every field once, the reference.
- `tests/unit/i18n/site-copy.test.ts` — every new string exists in Albanian
  with the same placeholders.
- `tests/e2e/public/landing.spec.ts` — the story, now in the window; the
  Full View's index rail goes to ROZARIS.
- `tests/e2e/public/site.spec.ts` — the masthead panels and Escape, a
  Solutions link opening a story, the section cut, the price book, sign in →
  apply → received, and the phone menu.

## 11. What is left

- **Deliver applications.** Replace the log line in `lib/actions/apply.ts`
  with an email to `siteContact.sales`, a table, or the CRM — `parsed.data` is
  already trusted. The contact form needs the same.
- **Contractor access** on someone else's project is marked "Soon" on `/apply`.
- The canvas's role count said 16; the registry has 15 membership roles and the
  site says what the registry says.
- The Full View still opens with its earlier hero; it is the one page not yet
  redrawn.
