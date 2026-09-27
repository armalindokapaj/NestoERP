# Contrast measurements (AUD-11 §6, AV-10)

Measured from the values `styles/tokens.css` declares, per scheme: each token's
`light-dark()` half is resolved (following `var()` references), translucent
paints are composited over the ground they sit on (the top bar's `surface/85`
over `canvas`), and the WCAG 2 contrast ratio is computed.

- Source of truth for the list: `lib/a11y/contrast-pairs.ts`. Arithmetic: `lib/a11y/contrast.ts`.
- Gate: `tests/unit/a11y/contrast.test.ts` fails any pair below its threshold, in either scheme
  (`npx vitest run tests/unit/a11y`).
- Thresholds (project requirements, §6): `text` 4.5:1 (normal text; the product's largest UI text,
  20px section titles, is still treated as normal); `ui` 3:1 (control boundaries, focus rings, state
  indicators, information-bearing graphics).
- These are token-pair measurements. Rendered pages are additionally scanned by axe in
  `tests/e2e/a11y/aud11-shared.spec.ts` (written, not yet run), which checks computed colours in
  context, including hover, focus and open overlays.

## Token changes made by AUD-11 (minimal, no redesign)

| Token | Before (light, dark) | After (light, dark) | Why (measured before) |
|---|---|---|---|
| `--nesto-fg-subtle` | `#6a6f78`, `#868b94` | `#686d76`, `#8a8f98` | light 4.46:1 on `accent-soft`; dark 4.42:1 on `hover` |
| `--nesto-warning` | `#c58a25`, `#d9a552` | `#b27a1f`, unchanged | light fill 2.98:1 on white, 2.66:1 on the progress track |
| `--nesto-danger` | `#d9534f`, `#e8756f` | `#cc4540`, unchanged | white button text 3.96:1 (light) |
| `--nesto-danger-fg` (new) | — | `#ffffff`, `#0d0f14` | white on the dark red was 2.91:1; now 6.58:1 |
| `--nesto-control-border` (new) | — (controls used `border-strong` `#d8d8d5` / `#3a3e45`) | `#858a93`, `#70757e` | a text field's only boundary was 1.43:1 (light) and 1.62:1 (dark) |

`border` and `border-strong` are unchanged: they remain dividers and card edges, which are not the
sole identification of any control. The primitives whose outline *is* the control (Input, Textarea,
SelectTrigger, SearchField, Checkbox, the Switch off track, the global search and Quick Create
inputs) now use `border-control` (Tailwind `--color-control`).

## Exclusions, stated

- **Disabled controls** (`opacity-50`/`-60`) are exempt from the ratio (§6) but still show their
  label; the reason an action is unavailable must be given in adjacent text, not only by dimming.
- **Dividers** (`border`, `border-strong`, 1.2–1.8:1) are decoration.
- **Logos and the brand wordmark** are not assessed as text.
- **Pointer-hover tints** (`row-hover`, `hover`) are not a state indicator on their own; keyboard
  focus on menu and listbox rows now also draws the 2px ring (see AV-04).
- **Placeholder text** uses `fg-subtle`, measured as ordinary text above.

## Measured pairs

| Pair | Kind (min) | Light fg / bg | Light | Dark fg / bg | Dark | Where |
|---|---|---|---|---|---|---|
| fg on canvas | text (4.5) | #15171c / #f7f7f6 | 16.73 | #f2f2f0 / #101215 | 16.74 | body text, titles, labels |
| fg on surface | text (4.5) | #15171c / #ffffff | 17.93 | #f2f2f0 / #181a1e | 15.54 | body text, titles, labels |
| fg on surface-muted | text (4.5) | #15171c / #f2f2f1 | 16.01 | #f2f2f0 / #1f2228 | 14.22 | body text, titles, labels |
| fg on sidebar | text (4.5) | #15171c / #ffffff | 17.93 | #f2f2f0 / #141619 | 16.17 | body text, titles, labels |
| fg on row-hover | text (4.5) | #15171c / #fafafa | 17.18 | #f2f2f0 / #1d2025 | 14.57 | body text, titles, labels |
| fg on hover | text (4.5) | #15171c / #f2f2f1 | 16.01 | #f2f2f0 / #23262d | 13.51 | body text, titles, labels |
| fg on accent-soft | text (4.5) | #15171c / #eef0ff | 15.83 | #f2f2f0 / #1c2140 | 13.97 | body text, titles, labels |
| fg-muted on canvas | text (4.5) | #5b6068 / #f7f7f6 | 5.90 | #a8adb6 / #101215 | 8.32 | secondary text, ghost buttons, badge default, inactive nav |
| fg-muted on surface | text (4.5) | #5b6068 / #ffffff | 6.33 | #a8adb6 / #181a1e | 7.73 | secondary text, ghost buttons, badge default, inactive nav |
| fg-muted on surface-muted | text (4.5) | #5b6068 / #f2f2f1 | 5.65 | #a8adb6 / #1f2228 | 7.07 | secondary text, ghost buttons, badge default, inactive nav |
| fg-muted on sidebar | text (4.5) | #5b6068 / #ffffff | 6.33 | #a8adb6 / #141619 | 8.04 | secondary text, ghost buttons, badge default, inactive nav |
| fg-muted on row-hover | text (4.5) | #5b6068 / #fafafa | 6.06 | #a8adb6 / #1d2025 | 7.25 | secondary text, ghost buttons, badge default, inactive nav |
| fg-muted on hover | text (4.5) | #5b6068 / #f2f2f1 | 5.65 | #a8adb6 / #23262d | 6.72 | secondary text, ghost buttons, badge default, inactive nav |
| fg-muted on accent-soft | text (4.5) | #5b6068 / #eef0ff | 5.59 | #a8adb6 / #1c2140 | 6.95 | secondary text, ghost buttons, badge default, inactive nav |
| fg-subtle on canvas | text (4.5) | #686d76 / #f7f7f6 | 4.85 | #8a8f98 / #101215 | 5.77 | metadata, placeholders, group labels, icons |
| fg-subtle on surface | text (4.5) | #686d76 / #ffffff | 5.20 | #8a8f98 / #181a1e | 5.36 | metadata, placeholders, group labels, icons |
| fg-subtle on surface-muted | text (4.5) | #686d76 / #f2f2f1 | 4.64 | #8a8f98 / #1f2228 | 4.90 | metadata, placeholders, group labels, icons |
| fg-subtle on sidebar | text (4.5) | #686d76 / #ffffff | 5.20 | #8a8f98 / #141619 | 5.58 | metadata, placeholders, group labels, icons |
| fg-subtle on row-hover | text (4.5) | #686d76 / #fafafa | 4.98 | #8a8f98 / #1d2025 | 5.03 | metadata, placeholders, group labels, icons |
| fg-subtle on hover | text (4.5) | #686d76 / #f2f2f1 | 4.64 | #8a8f98 / #23262d | 4.66 | metadata, placeholders, group labels, icons |
| fg-subtle on accent-soft | text (4.5) | #686d76 / #eef0ff | 4.59 | #8a8f98 / #1c2140 | 4.82 | metadata, placeholders, group labels, icons |
| accent-strong on canvas | text (4.5) | #3f53e8 / #f7f7f6 | 5.42 | #94a1ff / #101215 | 7.86 | links, active nav, selected segmented option |
| accent-strong on surface | text (4.5) | #3f53e8 / #ffffff | 5.81 | #94a1ff / #181a1e | 7.30 | links, active nav, selected segmented option |
| accent-strong on surface-muted | text (4.5) | #3f53e8 / #f2f2f1 | 5.19 | #94a1ff / #1f2228 | 6.68 | links, active nav, selected segmented option |
| accent-strong on sidebar | text (4.5) | #3f53e8 / #ffffff | 5.81 | #94a1ff / #141619 | 7.60 | links, active nav, selected segmented option |
| accent-strong on row-hover | text (4.5) | #3f53e8 / #fafafa | 5.57 | #94a1ff / #1d2025 | 6.85 | links, active nav, selected segmented option |
| accent-strong on hover | text (4.5) | #3f53e8 / #f2f2f1 | 5.19 | #94a1ff / #23262d | 6.35 | links, active nav, selected segmented option |
| accent-strong on accent-soft | text (4.5) | #3f53e8 / #eef0ff | 5.13 | #94a1ff / #1c2140 | 6.56 | links, active nav, selected segmented option |
| success-strong on success-soft | text (4.5) | #187b51 / #e9f5ef | 4.70 | #5ecb9c / #14241d | 8.08 | StatusBadge / Badge tone |
| success-strong on surface | text (4.5) | #187b51 / #ffffff | 5.26 | #5ecb9c / #181a1e | 8.71 | status figures, error text |
| success-strong on canvas | text (4.5) | #187b51 / #f7f7f6 | 4.91 | #5ecb9c / #101215 | 9.38 | status text on the page ground |
| warning-strong on warning-soft | text (4.5) | #8f641b / #f9f1e3 | 4.67 | #e5b96f / #2a2114 | 8.67 | StatusBadge / Badge tone |
| warning-strong on surface | text (4.5) | #8f641b / #ffffff | 5.24 | #e5b96f / #181a1e | 9.54 | status figures, error text |
| warning-strong on canvas | text (4.5) | #8f641b / #f7f7f6 | 4.89 | #e5b96f / #101215 | 10.27 | status text on the page ground |
| danger-strong on danger-soft | text (4.5) | #c4302b / #fbedec | 4.84 | #f28f89 / #2c1817 | 7.25 | StatusBadge / Badge tone |
| danger-strong on surface | text (4.5) | #c4302b / #ffffff | 5.52 | #f28f89 / #181a1e | 7.52 | status figures, error text |
| danger-strong on canvas | text (4.5) | #c4302b / #f7f7f6 | 5.15 | #f28f89 / #101215 | 8.10 | status text on the page ground |
| info-strong on info-soft | text (4.5) | #3f53e8 / #eef0ff | 5.13 | #94a1ff / #1c2140 | 6.56 | StatusBadge / Badge tone |
| info-strong on surface | text (4.5) | #3f53e8 / #ffffff | 5.81 | #94a1ff / #181a1e | 7.30 | status figures, error text |
| info-strong on canvas | text (4.5) | #3f53e8 / #f7f7f6 | 5.42 | #94a1ff / #101215 | 7.86 | status text on the page ground |
| fg-muted on surface-muted | text (4.5) | #5b6068 / #f2f2f1 | 5.65 | #a8adb6 / #1f2228 | 7.07 | StatusBadge / Badge default |
| fg on hover | text (4.5) | #15171c / #f2f2f1 | 16.01 | #f2f2f0 / #23262d | 13.51 | StatusBadge / Badge neutral, subtle button |
| primary-fg on primary | text (4.5) | #ffffff / #465cff | 4.96 | #0d0f14 / #7c8cff | 6.44 | primary button, checked checkbox |
| primary-fg on primary-hover | text (4.5) | #ffffff / #3a4ce6 | 6.26 | #0d0f14 / #94a1ff | 8.03 | primary button hover |
| accent-fg on accent | text (4.5) | #ffffff / #465cff | 4.96 | #0d0f14 / #7c8cff | 6.44 | accent button, activity count |
| danger-fg on danger | text (4.5) | #ffffff / #cc4540 | 4.67 | #0d0f14 / #e8756f | 6.58 | danger button, critical count |
| graphite-fg on graphite | text (4.5) | #ffffff / #15171c | 17.93 | #15171c / #e9e9e5 | 14.73 | tooltip, brand panel |
| fg-muted on surface/85 on canvas | text (4.5) | #5b6068 / #fefefe | 6.26 | #a8adb6 / #17191d | 7.83 | top bar controls over the translucent bar |
| control-border on canvas | ui (3) | #858a93 / #f7f7f6 | 3.24 | #70757e / #101215 | 4.05 | input, textarea, select, search, checkbox, switch off track |
| control-border on surface | ui (3) | #858a93 / #ffffff | 3.47 | #70757e / #181a1e | 3.76 | input, textarea, select, search, checkbox, switch off track |
| control-border on surface-muted | ui (3) | #858a93 / #f2f2f1 | 3.10 | #70757e / #1f2228 | 3.44 | input, textarea, select, search, checkbox, switch off track |
| control-border on row-hover | ui (3) | #858a93 / #fafafa | 3.32 | #70757e / #1d2025 | 3.53 | input, textarea, select, search, checkbox, switch off track |
| control-border on sidebar | ui (3) | #858a93 / #ffffff | 3.47 | #70757e / #141619 | 3.91 | input, textarea, select, search, checkbox, switch off track |
| surface on control-border | ui (3) | #ffffff / #858a93 | 3.47 | #181a1e / #70757e | 3.76 | switch off: thumb against track |
| surface on accent | ui (3) | #ffffff / #465cff | 4.96 | #181a1e / #7c8cff | 5.85 | switch on: thumb against track |
| accent on surface | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #181a1e | 5.85 | focused control border |
| danger on surface | ui (3) | #cc4540 / #ffffff | 4.67 | #e8756f / #181a1e | 5.98 | invalid control border and ring |
| ring on canvas | ui (3) | #465cff / #f7f7f6 | 4.63 | #7c8cff / #101215 | 6.30 | 2px :focus-visible outline / ring-2 ring-ring |
| ring on surface | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #181a1e | 5.85 | 2px :focus-visible outline / ring-2 ring-ring |
| ring on surface-muted | ui (3) | #465cff / #f2f2f1 | 4.43 | #7c8cff / #1f2228 | 5.35 | 2px :focus-visible outline / ring-2 ring-ring |
| ring on sidebar | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #141619 | 6.09 | 2px :focus-visible outline / ring-2 ring-ring |
| ring on row-hover | ui (3) | #465cff / #fafafa | 4.75 | #7c8cff / #1d2025 | 5.49 | 2px :focus-visible outline / ring-2 ring-ring |
| ring on hover | ui (3) | #465cff / #f2f2f1 | 4.43 | #7c8cff / #23262d | 5.09 | 2px :focus-visible outline / ring-2 ring-ring |
| ring on accent-soft | ui (3) | #465cff / #eef0ff | 4.38 | #7c8cff / #1c2140 | 5.26 | 2px :focus-visible outline / ring-2 ring-ring |
| accent on surface | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #181a1e | 5.85 | active tab underline |
| accent on canvas | ui (3) | #465cff / #f7f7f6 | 4.63 | #7c8cff / #101215 | 6.30 | active tab underline on the page |
| accent on accent-soft | ui (3) | #465cff / #eef0ff | 4.38 | #7c8cff / #1c2140 | 5.26 | active navigation marker and icon |
| primary on surface | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #181a1e | 5.85 | checked checkbox |
| accent on surface | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #181a1e | 5.85 | chart series, status dot, progress fill |
| accent on hover | ui (3) | #465cff / #f2f2f1 | 4.43 | #7c8cff / #23262d | 5.09 | progress and bar-chart fill against its track |
| success on surface | ui (3) | #1f9d68 / #ffffff | 3.45 | #46b98a / #181a1e | 7.11 | chart series, status dot, progress fill |
| success on hover | ui (3) | #1f9d68 / #f2f2f1 | 3.08 | #46b98a / #23262d | 6.18 | progress and bar-chart fill against its track |
| warning on surface | ui (3) | #b27a1f / #ffffff | 3.69 | #d9a552 / #181a1e | 7.84 | chart series, status dot, progress fill |
| warning on hover | ui (3) | #b27a1f / #f2f2f1 | 3.29 | #d9a552 / #23262d | 6.82 | progress and bar-chart fill against its track |
| danger on surface | ui (3) | #cc4540 / #ffffff | 4.67 | #e8756f / #181a1e | 5.98 | chart series, status dot, progress fill |
| danger on hover | ui (3) | #cc4540 / #f2f2f1 | 4.17 | #e8756f / #23262d | 5.20 | progress and bar-chart fill against its track |
| info on surface | ui (3) | #465cff / #ffffff | 4.96 | #7c8cff / #181a1e | 5.85 | chart series, status dot, progress fill |
| info on hover | ui (3) | #465cff / #f2f2f1 | 4.43 | #7c8cff / #23262d | 5.09 | progress and bar-chart fill against its track |
| fg-subtle on surface | ui (3) | #686d76 / #ffffff | 5.20 | #8a8f98 / #181a1e | 5.36 | chart series, status dot, progress fill |
| fg-subtle on hover | ui (3) | #686d76 / #f2f2f1 | 4.64 | #8a8f98 / #23262d | 4.66 | progress and bar-chart fill against its track |
| cal-task on surface | ui (3) | #5563d6 / #ffffff | 5.07 | #8d97f0 / #181a1e | 6.49 | calendar category rail and dot |
| cal-meeting on surface | ui (3) | #7a62b8 / #ffffff | 4.92 | #a996dc / #181a1e | 6.71 | calendar category rail and dot |
| cal-project on surface | ui (3) | #59606b / #ffffff | 6.34 | #9aa1ab / #181a1e | 6.69 | calendar category rail and dot |
| cal-milestone on surface | ui (3) | #2f5ea8 / #ffffff | 6.39 | #7ea2de / #181a1e | 6.73 | calendar category rail and dot |
| cal-hr on surface | ui (3) | #3f8f8a / #ffffff | 3.81 | #6fbdb6 / #181a1e | 7.99 | calendar category rail and dot |
| cal-finance on surface | ui (3) | #2f8a5e / #ffffff | 4.27 | #5fbf8f / #181a1e | 7.75 | calendar category rail and dot |
| cal-legal on surface | ui (3) | #9a7446 / #ffffff | 4.23 | #c9a574 / #181a1e | 7.56 | calendar category rail and dot |
| cal-procurement on surface | ui (3) | #b27a1f / #ffffff | 3.69 | #d9a552 / #181a1e | 7.84 | calendar category rail and dot |
| cal-qaqc on surface | ui (3) | #2d8aa6 / #ffffff | 3.96 | #62b8d1 / #181a1e | 7.71 | calendar category rail and dot |
| cal-hse on surface | ui (3) | #6b7079 / #ffffff | 4.98 | #9ca1aa / #181a1e | 6.71 | calendar category rail and dot |
| cal-document on surface | ui (3) | #5f7187 / #ffffff | 5.00 | #97a8bd / #181a1e | 7.18 | calendar category rail and dot |
| cal-engineering on surface | ui (3) | #46708f / #ffffff | 5.28 | #88b1cf / #181a1e | 7.66 | calendar category rail and dot |
| cal-company on surface | ui (3) | #3b3f46 / #ffffff | 10.58 | #c2c5cb / #181a1e | 10.07 | calendar category rail and dot |
| cal-personal on surface | ui (3) | #9a7fbf / #ffffff | 3.41 | #bea6df / #181a1e | 8.06 | calendar category rail and dot |
