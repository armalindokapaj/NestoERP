# Testing responsive work (MOB-01)

## Matrix

Widths: 320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440. Also landscape
phone (844×390). The Playwright projects in `playwright.config.ts`
(`aud04-phone-320` … `aud04-desktop-1440`) run every spec named
`tests/e2e/responsive/aud04-*.spec.ts`, so a new responsive spec gets the whole
matrix by following that name.

## Automated

- `tests/unit/responsive/mob01-foundation.test.ts` — tokens exist, breakpoints in CSS equal `BREAKPOINTS`, `PageContainer`, `Stack`, `ResponsiveGrid`, sticky offsets, visibility and input presets. No browser needed. `npx vitest run tests/unit/responsive`.
- `tests/e2e/responsive/aud04-mob01-foundation.spec.ts` — the overflow guard on dashboard, projects, project detail, tasks, documents, a form-heavy page, a table-heavy page and clients; plus the page-container gutter. `npx playwright test tests/e2e/responsive/aud04-mob01-foundation.spec.ts --project=aud04-phone-320`.
- `tests/e2e/responsive/geometry.ts` — the shared measurements: `expectNoPageOverflow` (`scrollWidth <= clientWidth`, names the widest offender), `expectTouchTargets` (44px hit-test), `expectInViewport`.
- `tests/unit/a11y/*` — contrast pairs and theme drift.

## Guardrail

Every new route that is reachable on a phone gets an `expectNoPageOverflow`
call in a responsive spec. Deliberate wide regions scroll inside themselves.

## Manual, before a release that touches shared UI

iOS Safari (iPhone SE width and a Pro Max), Android Chrome (360 and 412),
an iPad portrait, Safari macOS, Chrome and Edge desktop. Open the keyboard on a
text, a numeric and an email field: the focused field stays visible, a sticky
action bar rides above the keyboard, nothing stays offset after it closes.
Repeat with reduced motion on and in landscape. Installed-PWA checks apply only
where the app is installed.

E2E shares the dev database; do not seed or restart the server while it runs.
