> **Chat:** Nesto — mobile for the site team
> **File:** docs/mobile/mobile-shell.md
> **About:** How the app shell is built below 1024px — the component tree, the widths, the space the bar keeps, the keyboard, layers and motion — for whoever changes the phone shell next.
> **Last updated:** 2026-11-12

# Mobile shell

What the phone looks like and why is in `docs/ui/UI-04-navigation-layouts.md`
§6; the rules are in `mobile-navigation.md`. This page is the build.

```
AppShell (components/layout/app-shell.tsx)
├── Topbar                          header[data-shell-region], 56px, glass
│   ├── PhoneTitle (below lg)       Back · the page's name, or the project switch
│   ├── QuickCreate                 below lg only its sheet, opened by New
│   └── GlobalSearch                below lg alone, in a cell
├── PhoneSections (below lg)        the page's sections, pinned under the top bar
├── <main class="nesto-page">
└── PhoneBar (below lg)             Home · Projects · New · Inbox · Menu
```

One shell, one tree, the widths decided in CSS (`lg:hidden`, `max-lg:…`).
Nothing branches on the user agent. A foldable or a split window gets what its
width says.

## Widths

| Width | Shell |
| --- | --- |
| < 1024 | The phone shell above, phones and tablets alike. |
| ≥ 1024 | The top bar with the Ribbon, the logo's panel, + Create, the bell and the account. No bar. |

## The space the bar keeps

- `--nesto-bottom-nav-space` is `calc(4rem + safe-bottom)` while
  `[data-mobile-bottom-nav]` is on the page, and `--nesto-bottom-reserve`
  follows it (toasts, focus scrolling). `.nesto-page` pads by it; modules add
  no bottom padding.
- The bar folds to 48px while scrolling down; the page keeps the full 64px
  clear, so nothing moves when it opens again.
- It steps aside for a page's own hand-made bottom bar
  (`data-sticky-action-bar`) and while a text field has focus, coming back
  0.3s after the field lets go, so the tap that ends the typing lands where
  it was aimed (`styles/globals.css`).

## Sticky stack

- `--nesto-shell-header-h` is 3.5rem.
- `--nesto-shell-tabs-h` is 3rem while the section row is there, and before
  hydration while a tab row's server-drawn anchor (`data-section-level`) says
  the page has sections — the row's place is held, so the page does not jump.
- Layers: the top bar 30, the section row and the bar 28. New's sheet, the
  project list and Menu's popups sit above both, with the page dimmed.

## Glass

Bars at 82% of the page with a 14px blur; the section row 60% and 12px; sheets
and drops 86–90% and 16px. The blur sits on a layer behind each bar, never on
the bar: a backdrop filter would trap the bar's fixed children inside it.

## New

New dispatches `nesto:open-quick-create` (`OPEN_QUICK_CREATE_EVENT`) with the
button as its opener. Quick Create opens as a sheet standing on the bar, with
the actions the server returns for this person and page, so project prefill
works as on a desktop; on a phone the field's four come first. Pressed again,
it closes; focus goes back to New.

## Analytics seam

`lib/navigation/analytics.ts` `emitNavigationEvent` dispatches
`nesto:navigation-event` on `window`: `navigation_destination_opened`
(`source: "phone_bar" | "phone_menu" | "phone_sections"`),
`quick_create_opened`, `more_opened` (the logo's panel). No dependency, no
payload beyond ids.

## Motion and accessibility

Reduced-motion aware throughout. Every control is a real button or link with a
visible name — the bar's cells keep theirs when folded. Focus returns to the
trigger when a sheet closes. Targets are 48px.
