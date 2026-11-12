> **Chat:** Nesto — mobile for the site team
> **File:** docs/mobile/mobile-navigation.md
> **About:** The rules behind the phone's navigation below 1024px — who decides what a person sees, which place a page belongs to, where Projects goes, and how to add a module — for whoever changes it next.
> **Last updated:** 2026-11-12

# Mobile navigation rules

The layout itself — the bar, the top bar, the section row, Inbox and Menu —
is in `docs/ui/UI-04-navigation-layouts.md` §6. This page is the rules.

## Authority

```
user -> memberships -> role/permissions -> module activation
   -> resolveNavigation (config/navigation.ts)        what this person may open
   -> lib/navigation/phone.ts                           placement only
   -> the bar's five places | Menu
```

`lib/navigation/phone.ts` never checks a permission and never adds a
destination. It says which place a path belongs to, which pages are a place's
first, and where Projects goes. Menu lists exactly what `resolveNavigation`
returned for this person, in the Ribbon's departments and sets.

## The five places

Home (`/my-day`), Projects, New, Inbox (`/inbox`), Menu (`/menu`). Fixed: they
are places in the work, not modules, so they do not move with permissions. A
person who may create nothing gets no New; nobody gets a dead cell.

## Which place a page belongs to

`placeOf(pathname)`:

| Place | Paths |
| --- | --- |
| Home | `/my-day`, `/dashboard` |
| Projects | everything under `/projects` |
| Inbox | `/inbox`, `/approvals`, `/activity`, `/notifications` |
| Menu | everything else — it was reached through Menu |

A place's first page (`isPlaceRoot`) has no Back in the top bar: the bar is
the way out. A project's own page counts as Projects' first page.

## Projects remembers

Projects opens the project you were last in, in this workspace, on this
device (`localStorage`, key `nesto-last-project`, one id per workspace —
never a record's content). Before any, it opens the list. A stored id is only
a link: the project page still decides whether this person may open it.

## Sections

A page's sections are what its own tab rows register
(`components/navigation/section-registry.tsx`), already filtered by
permission. The phone's row shows the innermost level; it can hold nothing
the tab row would not have shown.

## Workspace switch

From Menu's head. `/menu` and `/inbox` are global routes
(`config/workspace-routes.ts`), so a switch made there stays there. Leaving a
form with unsaved work for Menu asks first, as any navigation does.

## Account

Your profile, Settings, Refresh, Day or Night, Help and Sign out are at the
foot of Menu below 1024px, and in the account panel from 1024px. Sign out is
`useSignOut`: it asks about unsaved work, ends the session and clears client
state.

## Adding a module

Register it in `config/modules.ts` with its permission and group, and place it
in `config/navigation.ts`. It appears in the Ribbon, the logo's panel and Menu
on its own. Nothing is added to the bar.
