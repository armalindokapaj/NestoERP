# Component guidelines (MOB-01)

## Is my component mobile-ready?

A shared component is mobile-ready when all ten hold:

1. It renders at 320px without breaking its page.
2. Required actions remain reachable.
3. Text is readable and wraps or truncates on purpose.
4. Nothing needed depends on hover (`group-hover` may enhance, never gate).
5. Touch targets are 44px under `touch:`.
6. Focus works, is visible, and returns to the trigger on close.
7. It has a loading state.
8. It has an error state.
9. Long content (a 60-character project name, a long email) does not overflow.
10. Desktop looks and behaves as before.

## Which component

| Job | Component |
|---|---|
| Page width and gutters | `PageContainer` |
| Row of actions that stacks on a phone | `Stack direction="row" stackBelow="sm" reverseWhenStacked fillWhenStacked` |
| Columns that collapse | `ResponsiveGrid`, `FormGrid` |
| Surface | `Card` (+ `CardHeader/Title/Content/Footer`) |
| Button, busy button | `Button`, `loading` |
| Icon-only button | `IconButton label="…"` |
| Field | `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`; keyboard hints from `inputModes` |
| Status | `StatusBadge` (module statuses), `Badge wrap` for long labels |
| Loading | `SkeletonPage/Cards/Table/Card/List/Form`, `InlineLoader`, `Button loading` |
| Empty | `EmptyState`, `NoResultsState` |
| Error | `PageError`, `SectionError`, `InlineError`, `NetworkError`, `PermissionError`, `NotFound` |
| Sticky | `StickyStack`, `StickyHeader/SubHeader/Tabs`, `StickyActions` |
| Overlay | see the table in `responsive-system.md` |
| Canvas | `TechnicalViewport` |

If an equivalent exists, extend it. Do not add a second one.

## Rules of thumb

- Do not hide overflow to make a bug disappear; find the child that is too wide (`min-w-0`, wrap, or a contained scroller).
- Do not use `!important`; the one exception is the global reduced-motion reset.
- Do not use `100vh`; use `dvh` with a `vh` fallback (`.nesto-technical-viewport`).
- Errors never show raw exceptions and always offer a way forward where one exists.
- Switches are for immediate preferences, never for destructive actions.
- A toast is not the only place a critical failure appears.
