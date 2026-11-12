> **Chat:** Nesto — mobile for the site team
> **File:** docs/ui/UI-06-create-dial.md
> **About:** The desktop Create dial — the + floating at the bottom right that fans out the five things each user type makes most — what it looks like, why each role gets its five, how it stays inside a person's access, and where the code and tests are.
> **Last updated:** 2026-11-12 (first version: Create leaves the top bar, Units with it)

# UI-06 — The Create dial

From `lg` (1024px) Create is no longer in the top bar. It is a **+ floating at
the bottom right of every page**, as on the reference site
(tirana.7fstudio.com). Hovering it fans out **five actions chosen for the
person's user type**; clicking the + itself opens the full Create menu, every
action they may create. Units left the top bar with it: Units is in the Sales
tab, in the logo's panel, and in the phone's bar as Sales units.

Below `lg` nothing changes: the phone's bar keeps New, which opens the same
menu as a sheet (UI-04 §6).

## 1. What it looks like

Taken from the reference's `.tvnav` dial, in Nesto's tokens:

| Part | Size and place | Motion |
| --- | --- | --- |
| The + | 62px ink circle, 30px from the right edge and 40px from the bottom (more where the device has safe-area insets) | grows to 1.08 while open; the + turns into × while the full menu is open |
| The five | 44px circles in a column above the +, 52px apart, the role's first nearest the + | spring up one after another (0.45s, a small overshoot, 32ms apart); fold back the farthest first (18ms apart) |
| Each label | mono 12px capitals with wide spacing, a pill to the left of its circle on the page's glass with a 1px line | the circle and its label turn gold on hover or keyboard focus |
| The full menu | the existing Create panel, 320px wide, standing above the +, its right edge on the dial's | — |

With reduced motion the five fade in and out in place. Folded, they are
hidden once the fold has played: nothing to click, tab to or hear.

**How it opens.** A mouse over the + fans the five out; leaving them folds
them 0.2s later, so crossing the gaps keeps them out. A click on the + opens
the full menu. A finger has no hover: the first tap fans the five out, a
second tap on the + opens the full menu. From the keyboard, Tab onto the +
fans them out and Tab walks up the five; Enter on the + opens the full menu;
Escape folds them. The `C` shortcut still opens the full menu.

**Room.** Pages end 6.5rem higher from `lg`, and toasts and focus scrolling
stop above the dial (`--nesto-dial-space`, `styles/globals.css`), so the +
never covers a page's last row or a toast.

## 2. Each user type's five

What each role makes most, from what the role is for (`config/roles.ts`), the
create rights it holds by default (`config/role-defaults.ts`) and how the
work runs on a building site and in a developer's office. The first sits
nearest the +.

| User type | The five, nearest first | Why |
| --- | --- | --- |
| Owner | Project · Contract · Task · Meeting · Announcement | Governs the group: starts projects, signs, delegates, meets and tells everyone |
| CEO | Project · Opportunity · Contract · Task · Meeting | Runs the company: the projects, and the business that pays for them |
| Project manager | Daily log · Task · Meeting · Purchase request · RFI | Runs the site: today's diary, the work, the site meeting, the materials, the question to the designer |
| Architect | Drawing · RFI · Document · Meeting · Task | Design: drawings, the questions about them, the files and reviews around them |
| Engineer | Daily log · Inspection · RFI · HSE hazard · Task | On site: the diary, the check, the question, the hazard seen |
| Finance | Invoice · Expense · Payment · Budget · Task | Money in, money out, money planned |
| Legal | Contract · Document · Meeting · Task | Contracts and the paper around them (four chosen; the fifth is filled, §3) |
| Sales | Lead · Client · Opportunity · Proposal · Meeting | From first contact to the offer on the table |
| Procurement | Purchase request · Enquiry (RFQ) · Supplier · Document · Task | Asking to buy, asking for prices, finding who sells |
| Inventory | Receipt · Stock issue · Stock transfer · Inventory item · Purchase request | Stock in, out, moved, a new item, and asking for more |
| QA/QC | Inspection · NCR · Defect · Document · Task | Checking the work and recording what is wrong with it |
| HSE | HSE inspection · HSE hazard · HSE incident · HSE permit · Toolbox talk | Looking, reporting, permitting, briefing |
| HR | Employee · Leave request · Announcement · Meeting · Task | People: hiring, leave, telling everyone |
| Group IT | Task · Meeting · Announcement | Keeps the systems running; makes little in the company itself (three chosen; the rest filled, §3) |
| Platform admin, Viewer | — | Work outside any company, or read only: no dial |

The order is `CREATE_DIAL` in `config/create-dial.ts`. To change a role's five,
change its line there; the unit test checks that each choice is a real Quick
Create action the role may create by default.

## 3. Access decides, the list only orders

The dial never grants anything. The server works out which actions this
person may create in this workspace — the module switched on, the module's
access, the permission (`lib/modules/quick-create/eligibility.ts`) — and
`dialActions(role, eligible)` keeps the role's choices among those, in the
role's order. When fewer than five are left (a module switched off, a
narrower access profile), it fills up from the other actions the person may
create, in the registry's order, so nobody with something to create gets an
empty dial; someone who may create nothing gets no + at all. The five ride
on the shell's Quick Create summary (`QuickCreateShellDTO.dial`), so the dial
is drawn with the page and needs no request of its own.

Picking one of the five takes the same path as picking it from the full
menu: the menu is read (it is fetched ahead while the dial is open), the
action's company or project step opens the panel where one is needed, and
the launch goes to `/api/quick-create/launch`, which checks access again.

## 4. New actions

The five needed actions the menu did not have. Each opens the module's own
create page; the two Engineering ones open their register with its New
dialog (`?new=1`), as Engineering creates in a dialog:

Announcement, RFI, Drawing, Lead, Proposal, Contract, Payment, Budget,
Enquiry, Supplier, Receipt, Stock issue, Stock transfer, Inventory item,
Inspection, Defect, HSE inspection, HSE permit, Toolbox talk, Employee and
Leave request — in `config/quick-create.ts`, with their English and Albanian
names and the glossary's nouns. They also appear in the full menu and on the
phone's New, under four new groups: Engineering, Legal, Inventory and HR.

## 5. Code

- `components/layout/quick-create.tsx` — the dial, the + and the panel.
- `config/create-dial.ts` — each role's five and `dialActions`.
- `config/quick-create.ts` — the actions; `components/layout/create-icons.ts`
  their icons, shared with the panel.
- `lib/modules/quick-create/context-key.ts` — the dial in the shell summary.
- `styles/globals.css` — `.nesto-dial-item` and `--nesto-dial-space`.

## 6. Tests

- `tests/unit/navigation/create-dial.test.ts` — at most five per role, real
  actions the role holds, the role's order, eligibility first, filling up.
- `tests/unit/navigation/navigation-layouts.test.ts` — no Units in the top
  bar; the dial is drawn.
- `tests/e2e/shell/top-bar.spec.ts` — the +'s place, the panel above it, and
  Sales' five fanning out and opening a new lead. Needs the database to run.
