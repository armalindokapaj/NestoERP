# Mobile navigation rules (MOB-02)

## Authority

```
user -> memberships -> role/permissions -> module activation
   -> resolveNavigation (config/navigation.ts)
   -> resolveMobileNavigation (lib/navigation/mobile.ts)   placement only
   -> bottom bar | More
```

`resolveMobileNavigation(groups)` never checks a permission and never adds an
item. A test asserts that everything it returns was in its input and that every
input item appears exactly once.

## Primary destinations

Set in `config/modules.ts` as `mobilePriority: "primary"`: Home (Dashboard),
Projects, Tasks. At most `MAX_PRIMARY_DESTINATIONS` (3) are used, plus Create
(phone, only when Quick Create has actions) and More: never more than five
slots. A restricted person gets fewer buttons, not dead ones. To promote a
module, add the metadata; do not list routes in a component.

Labels are the module's translated label; Dashboard reads "Home".

## More

Everything not in the bar, in its existing group. Searchable above eight items.
No count badges: no cheap canonical count exists yet, and a decorative
per-module request is not worth it (MOB-06 adds daily counters).

## Not in the bar

Admin Console and the 3D viewer are reached through More or a project, never as
permanent destinations.

## Active state

By route hierarchy (`activeNavigationKey`), so nested routes keep their parent.
More is marked active when the current module lives in it.

## Account

Profile, Settings and sign-out are in More on a phone and in the account menu
from 768. Sign-out is `useSignOut`: it asks about unsaved work, ends the
session and clears client state through `logout()` in `lib/auth/client-lifecycle`.

## Adding a destination

Register the module in `config/modules.ts` with its permission and group. It
appears on desktop, the tablet drawer and in More automatically. Only add
`mobilePriority` if it should be in the bar, and remember the bar holds three.
