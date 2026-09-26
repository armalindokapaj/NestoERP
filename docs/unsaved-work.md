# Unsaved work protection (AUD-03)

Every editor that holds input a person could lose takes part in one contract. A
departure — a link, Back, closing a dialog, a workspace switch, signing out, a
reload — asks the tab's coordinator first, and goes on only with the one-shot
approval it answers. A save has an explicit outcome, and only a committed answer
is persistence.

Decisions and their reasons: [ADR 0018](adr/0018-unsaved-work-protection.md). The
coverage manifest: [unsaved-work-manifest.md](unsaved-work-manifest.md).

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Coordinator | `lib/unsaved/coordinator.ts` | Registry keyed by editor id (Strict-Mode safe), `requestDeparture(intent)`, one-shot `Approval`s bound to editor revisions and identity, freeze, telemetry events. Pure TS. |
| Host | `components/unsaved/unsaved-host.tsx` | Mounted once in `AppShell`. Renders the prompt and the context notices; owns the single `beforeunload`; installs the Back/Forward guard and the stale-context header; the identity channel. |
| Editor hooks | `components/unsaved/use-unsaved.ts` | `useUnsavedEditor` (explicit flags), `useFormDirty` (a native form's semantic baseline), `UnsavedScope`. |
| Save hook | `components/unsaved/use-editor-save.ts` | `useEditorSave`: a form's submit under the contract — lock, outcome, messages, focus, rebaseline, Save and continue. |
| Status UI | `components/unsaved/editor-status.tsx` | `SaveMessages` (persistent refusal + "not saved"/"unknown"), `UnsavedIndicator`. |
| Guarded dialogs | `components/unsaved/guarded-root.tsx` | `Dialog` and `Drawer` roots: every close asks about the editors inside. `useDialogClose()` for a custom Cancel. |
| Guarded navigation | `components/navigation/guarded-router.ts`, `nav-link.tsx` | `useRouter` (drop-in for `next/navigation`), `guardNavigation(intent, go)`; `NavLink` asks in `onNavigate`. |
| History guard | `lib/unsaved/history-guard.ts` | Back/Forward reconciliation with the Navigation API index. |
| Outcomes | `lib/unsaved/outcome.ts`, `lib/forms/committed.ts` | `outcomeOf(result)`, `committed(href)`, the copy. |
| Context guard | `lib/context/tab-workspace.ts` | The server refuses a write from a tab that renders another workspace. |

## Making an editor take part

**A `RecordForm`** takes part already. Its server action must answer, not
redirect:

```ts
revalidatePath(...);
return committed(`/clients/${id}`); // not redirect(...)
```

and its result type's success branch carries `redirectTo?: string`. Pass
`saveKind="create"` when the submit label does not start with Create/Add/New/…,
and `module` (a key of `GUARD_MODULES` in `lib/navigation/telemetry-registry.ts`).
Anything the form submits must be in a named input — a custom control writes a
hidden input, a line-item grid names its rows' inputs — because dirtiness is
what the form would submit.

**A custom `<form>`** uses the same machine:

```tsx
const formRef = React.useRef<HTMLFormElement>(null);
const save = useEditorSave({ formRef, action, module: "hse", saveKind: "save", label: "Hazard" });
return (
  <form ref={formRef} onSubmit={save.onSubmit}>
    <SaveMessages save={save} />
    <fieldset disabled={save.pending || Boolean(save.saved)} className="m-0 min-w-0 border-0 p-0">…fields…</fieldset>
    <Button type="submit" disabled={save.pending}>Save</Button>
    <UnsavedIndicator save={save} />
  </form>
);
```

`prepare` adds a one-submission decision to the form data (Clients' "Create
anyway"); `onRefused` shows a refusal the form owns (answer `true`);
`onCommitted` handles a committed save itself (answer `true` when it navigated
or closed). An API-route save adapts its response with `outcomeOf`: `{ ok:
response.ok, code: body.error?.details?.code ?? body.error?.code, error:
body.error?.message, fieldErrors: … }`.

**A controlled editor without a form** — a grid, a composer, an inline editor —
registers itself and computes its own dirtiness against its own baseline:

```ts
const editor = useUnsavedEditor({ module: "meetings", saveKind: "save", label: "Minutes", save: saveMinutes });
React.useEffect(() => editor.setDirty(text !== baseline), [text, baseline, editor.setDirty]);
```

Its `save` answers a `SaveOutcome`. It calls `setSaving` around its requests and
`setUnresolved(true)` when a request threw. An in-place Cancel is
`editor.requestDismiss(() => reset())`: it asks only when something is unsaved,
and resets only on approval.

**A workflow-only editor** — its only way forward is Send, Submit, Approve,
Publish — registers with `saveKind: "none"` and `workflow: "Send"`, and no
`save`. The prompt offers Stay and Discard and says the step belongs in the
editor. Save and continue never sends or approves.

**Dialogs and drawers** are guarded by the primitives. A Cancel that closes the
dialog must go through `<DialogClose asChild>` or `useDialogClose()`; calling
`setOpen(false)` directly bypasses the question. A dialog that closes itself
after a committed save closes at once — the editor is clean by then. While its
request runs a dialog is `locked` (`<Dialog locked={pending}>`): closing is
ignored instead of asking a question whose Discard could not be carried out.
A `FormDialog` that opens a page after saving resolves `onSubmit` to
`{ redirectTo }` instead of navigating from inside it — the editor is still
saving there, and after the prompt's Save and continue the person's own
destination wins.

**Navigation** uses `NavLink` or `useRouter` from
`@/components/navigation/guarded-router`. `refresh()` keeps the page and its
values and never asks. `window.location` changes are for full loads that the
person already approved (`unsaved.forceLeave()` only after a decision made
elsewhere). A file download goes through `startDownload(url)`
(`lib/navigation/start-download.ts`), which lets that one forced-attachment
request past the unload prompt; the page stays.

**Files**: a named `<input type="file">` in a form is part of its snapshot (name,
size, time — never bytes). An upload in flight is `setPendingUploads(true)`.
Discarding local changes never deletes a stored document.

## What is never done

- No draft in `localStorage`, `sessionStorage`, the URL or telemetry.
- No `confirmed: true`: approvals are one-shot and bound to what they approved.
- No asynchronous save from `beforeunload` or `pagehide`.
- No automatic retry of a create or a workflow step after an unknown outcome.
- No reliance on an unmount to mean the person agreed.
