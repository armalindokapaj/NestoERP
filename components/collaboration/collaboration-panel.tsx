"use client";

import * as React from "react";
import { Bell, BellOff, MessageSquare, Pencil, RotateCw, Trash2 } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { CommentDTO, MentionableMemberDTO, ThreadDTO } from "@/lib/core/collaboration/collaboration.service";
import { cn } from "@/lib/utils/cn";
import { formatRelativeTime } from "@/lib/utils/format";

/**
 * The discussion on a business record (PRD #38 §36, §160, §161).
 *
 * Reusable on any record the registry allows collaboration on: give it a type
 * and an id. Everything it shows comes from the collaboration API, which
 * re-authorises the record on every request — this component decides nothing
 * about who may see what, it only reflects the answer.
 *
 * Plain text only. A comment is rendered as React text nodes, so markup in a
 * comment is shown as the characters somebody typed (PRD #38 §36, §39).
 */

const MAX_LENGTH = 5000;

const ERROR_TEXT: Record<string, string> = {
  COMMENT_EMPTY: "Write something first.",
  COMMENT_TOO_LONG: "Comments are limited to 5,000 characters.",
  MENTION_NOT_ALLOWED: "Someone you mentioned cannot see this record.",
  TOO_MANY_MENTIONS: "Mention at most 20 people in one comment.",
  PARENT_ARCHIVED: "This record is archived, so its discussion is closed.",
  COMMENT_ARCHIVED: "That comment was deleted.",
  RATE_LIMITED: "You are commenting too quickly. Try again in a moment.",
};

type ApiFailure = { status: number; code: string; message: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message?: string; details?: Record<string, string[]> } }
    | null;
  if (!response.ok) {
    const fieldMessage = json?.error?.details ? Object.values(json.error.details).flat()[0] : undefined;
    const failure: ApiFailure = {
      status: response.status,
      code: json?.error?.code ?? "INTERNAL_ERROR",
      message: fieldMessage ?? json?.error?.message ?? "Something went wrong.",
    };
    throw failure;
  }
  return (json?.data ?? (json as T)) as T;
}

function failureText(error: unknown): string {
  const failure = error as Partial<ApiFailure>;
  const key = failure?.message ?? "";
  return ERROR_TEXT[key] ?? (failure?.status === 404 ? "This record is no longer available." : key || "Something went wrong.");
}

export function CollaborationPanel({
  parentType,
  parentId,
  title = "Discussion",
  className,
}: {
  parentType: string;
  parentId: string;
  title?: string;
  className?: string;
}) {
  const toast = useToast();
  const base = `/api/collaboration/${encodeURIComponent(parentType)}/${encodeURIComponent(parentId)}`;
  const [thread, setThread] = React.useState<ThreadDTO | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [watchPending, setWatchPending] = React.useState(false);
  const liveRef = React.useRef<HTMLParagraphElement>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      const data = await api<ThreadDTO>(`${base}/comments`);
      setThread(data);
      setState("ready");
    } catch (error) {
      setState((error as ApiFailure).status === 404 ? "unavailable" : "error");
    }
  }, [base]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function loadOlder() {
    if (!thread?.nextBefore) return;
    setLoadingOlder(true);
    try {
      const older = await api<ThreadDTO>(`${base}/comments?before=${encodeURIComponent(thread.nextBefore)}`);
      setThread({ ...thread, comments: [...older.comments, ...thread.comments], nextBefore: older.nextBefore });
    } catch (error) {
      toast({ title: failureText(error), tone: "danger" });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function toggleWatch() {
    if (!thread) return;
    setWatchPending(true);
    try {
      const next = !thread.watching;
      await api(`${base}/watch`, { method: next ? "POST" : "DELETE" });
      setThread({ ...thread, watching: next, watcherCount: thread.watcherCount + (next ? 1 : -1) });
      toast({ title: next ? "You are watching this record." : "You stopped watching this record." });
    } catch (error) {
      toast({ title: failureText(error), tone: "danger" });
    } finally {
      setWatchPending(false);
    }
  }

  function upsertComment(comment: CommentDTO, announce?: string) {
    setThread((current) => {
      if (!current) return current;
      const exists = current.comments.some((row) => row.id === comment.id);
      return {
        ...current,
        comments: exists ? current.comments.map((row) => (row.id === comment.id ? comment : row)) : [...current.comments, comment],
        commentCount: exists ? current.commentCount : current.commentCount + 1,
        watching: current.watching || !exists,
      };
    });
    if (announce && liveRef.current) liveRef.current.textContent = announce;
  }

  return (
    <section
      aria-labelledby={`discussion-${parentType}-${parentId}`}
      className={cn("nesto-card p-5", className)}
      data-testid="collaboration-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`discussion-${parentType}-${parentId}`} className="flex items-center gap-2 text-card font-semibold text-fg">
          <MessageSquare aria-hidden="true" className="size-4 text-fg-subtle" />
          {title}
          {thread && thread.commentCount > 0 ? (
            <span className="text-meta font-normal text-fg-subtle">({thread.commentCount})</span>
          ) : null}
        </h2>
        {thread?.capabilities.canWatch ? (
          <Button
            variant={thread.watching ? "subtle" : "secondary"}
            size="sm"
            onClick={toggleWatch}
            disabled={watchPending}
            aria-pressed={thread.watching}
          >
            {thread.watching ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
            {thread.watching ? "Unwatch" : "Watch"}
          </Button>
        ) : null}
      </div>

      <p ref={liveRef} aria-live="polite" className="sr-only" />

      {state === "loading" ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading discussion">
          {[0, 1].map((key) => (
            <div key={key} className="flex gap-3">
              <div className="size-7 animate-pulse rounded-full bg-hover" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 animate-pulse rounded bg-hover" />
                <div className="h-3 w-full animate-pulse rounded bg-hover" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-table text-fg-muted" role="alert">
          The discussion could not be loaded.
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            <RotateCw aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      {state === "unavailable" ? (
        <p className="mt-4 text-table text-fg-muted">The discussion on this record is not available to you.</p>
      ) : null}

      {state === "ready" && thread ? (
        <>
          {thread.parent.archived ? (
            <p className="mt-3 rounded-md bg-surface-muted px-3 py-2 text-meta text-fg-muted">
              This record is archived. Its discussion stays readable, and is closed to new comments.
            </p>
          ) : null}

          {thread.nextBefore ? (
            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "Loading…" : "Show earlier comments"}
              </Button>
            </div>
          ) : null}

          {thread.comments.length === 0 ? (
            <p className="mt-4 text-table text-fg-muted">
              No comments yet.{thread.capabilities.canComment ? " Start the discussion below." : ""}
            </p>
          ) : (
            <ol className="mt-4 space-y-4">
              {thread.comments.map((row) => (
                <CommentItem
                  key={row.id}
                  comment={row}
                  onChanged={(updated) => upsertComment(updated)}
                  onArchived={() =>
                    setThread((current) =>
                      current
                        ? {
                            ...current,
                            comments: current.comments.map((item) =>
                              item.id === row.id ? { ...item, archived: true, segments: null, capabilities: { canEdit: false, canArchive: false } } : item,
                            ),
                          }
                        : current,
                    )
                  }
                  mentionSource={`${base}/mentionable`}
                />
              ))}
            </ol>
          )}

          {thread.capabilities.canComment ? (
            <CommentComposer
              mentionSource={`${base}/mentionable`}
              onSubmit={async (body) => {
                const created = await api<CommentDTO>(`${base}/comments`, {
                  method: "POST",
                  body: JSON.stringify({ body }),
                });
                upsertComment(created, "Comment posted.");
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CommentBody({ comment }: { comment: CommentDTO }) {
  if (comment.archived || !comment.segments) {
    return <p className="mt-1 text-table italic text-fg-subtle">This comment was deleted.</p>;
  }
  return (
    <p className="mt-1 whitespace-pre-wrap break-words text-body text-fg">
      {comment.segments.map((segment, index) =>
        segment.type === "mention" ? (
          <span key={index} className="rounded bg-accent-soft px-1 font-medium text-accent-strong">
            @<PersonLink memberId={segment.memberId} name={segment.name} />
          </span>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </p>
  );
}

/** Rebuilds the composer text a comment was written from, for editing. */
function editableText(comment: CommentDTO): { text: string; mentions: MentionToken[] } {
  const mentions: MentionToken[] = [];
  const text = (comment.segments ?? [])
    .map((segment) => {
      if (segment.type === "mention") {
        mentions.push({ name: segment.name, memberId: segment.memberId });
        return `@${segment.name}`;
      }
      return segment.text;
    })
    .join("");
  return { text, mentions };
}

function CommentItem({
  comment,
  onChanged,
  onArchived,
  mentionSource,
}: {
  comment: CommentDTO;
  onChanged: (comment: CommentDTO) => void;
  onArchived: () => void;
  mentionSource: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [first, ...rest] = comment.author.fullName.split(" ");
  // Relative time is computed after mount: the server has no business guessing
  // the reader's clock (and a mismatch is a hydration warning).
  const [relative, setRelative] = React.useState<string | null>(null);
  React.useEffect(() => setRelative(formatRelativeTime(comment.createdAt)), [comment.createdAt]);
  // A mention notification opens at its comment (Activity Center §43): scrolled to and briefly highlighted.
  const itemRef = React.useRef<HTMLLIElement>(null);
  const [targeted, setTargeted] = React.useState(false);
  React.useEffect(() => {
    if (window.location.hash !== `#comment-${comment.id}`) return;
    itemRef.current?.scrollIntoView({ block: "center" });
    setTargeted(true);
    const timer = window.setTimeout(() => setTargeted(false), 4000);
    return () => window.clearTimeout(timer);
  }, [comment.id]);

  return (
    <li ref={itemRef} id={`comment-${comment.id}`} className={cn("flex gap-3 rounded-md transition-colors", targeted && "bg-accent-soft/60 ring-2 ring-accent/40")} data-testid="comment" data-targeted={targeted || undefined}>
      <Avatar firstName={first} lastName={rest.join(" ")} src={comment.author.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <PersonLink memberId={comment.author.memberId} name={comment.author.fullName} className="text-table" />
          <time dateTime={comment.createdAt} className="text-meta text-fg-subtle" title={comment.createdAt}>
            {relative ?? ""}
          </time>
          {comment.editedAt && !comment.archived ? <span className="text-meta text-fg-subtle">(edited)</span> : null}
        </div>

        {editing ? (
          <CommentComposer
            mentionSource={mentionSource}
            initial={editableText(comment)}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const updated = await api<CommentDTO>(`/api/comments/${comment.id}`, {
                method: "PATCH",
                body: JSON.stringify({ body }),
              });
              onChanged(updated);
              setEditing(false);
            }}
          />
        ) : (
          <CommentBody comment={comment} />
        )}

        {!editing && (comment.capabilities.canEdit || comment.capabilities.canArchive) ? (
          <div className="mt-1 flex gap-1">
            {comment.capabilities.canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Edit comment">
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            ) : null}
            {comment.capabilities.canArchive ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label="Delete comment">
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this comment?"
        description="The comment is hidden from the discussion. Its author and time stay in the record's history."
        confirmLabel="Delete comment"
        pending={pending}
        onConfirm={async () => {
          setPending(true);
          try {
            await api(`/api/comments/${comment.id}`, { method: "DELETE" });
            onArchived();
            setConfirming(false);
          } catch (error) {
            toast({ title: failureText(error), tone: "danger" });
          } finally {
            setPending(false);
          }
        }}
      />
    </li>
  );
}

type MentionToken = { name: string; memberId: string };

/**
 * Turns `@Name` for every person picked in the menu into the server's mention
 * markup. Anything typed by hand stays plain text: only a pick from the list,
 * which the server offered, becomes a mention.
 */
function toMarkup(text: string, mentions: MentionToken[]): string {
  let output = text;
  for (const mention of mentions) {
    const plain = `@${mention.name}`;
    const index = output.indexOf(plain);
    if (index === -1) continue;
    output = `${output.slice(0, index)}@[${mention.name}](${mention.memberId})${output.slice(index + plain.length)}`;
  }
  return output;
}

function CommentComposer({
  mentionSource,
  onSubmit,
  onCancel,
  initial,
  submitLabel = "Comment",
}: {
  mentionSource: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  initial?: { text: string; mentions: MentionToken[] };
  submitLabel?: string;
}) {
  const id = React.useId();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [text, setText] = React.useState(initial?.text ?? "");
  const [mentions, setMentions] = React.useState<MentionToken[]>(initial?.mentions ?? []);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // Mention picker state: the query after "@", where it started, and results.
  const [query, setQuery] = React.useState<{ text: string; start: number } | null>(null);
  const [options, setOptions] = React.useState<MentionableMemberDTO[]>([]);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    if (!query) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${mentionSource}?q=${encodeURIComponent(query.text)}`, { signal: controller.signal });
        const json = (await response.json()) as { data?: MentionableMemberDTO[] };
        setOptions(json.data ?? []);
        setActive(0);
      } catch {
        setOptions([]);
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, mentionSource]);

  function detectMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([\p{L}\p{N}.'-]{0,40})$/u.exec(before);
    setQuery(match ? { text: match[2], start: caret - match[2].length - 1 } : null);
  }

  function pick(member: MentionableMemberDTO) {
    if (!query) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const insert = `@${member.fullName} `;
    const next = `${text.slice(0, query.start)}${insert}${text.slice(caret)}`;
    setText(next);
    setMentions((current) => (current.some((m) => m.memberId === member.memberId) ? current : [...current, { name: member.fullName, memberId: member.memberId }]));
    setQuery(null);
    requestAnimationFrame(() => {
      const position = query.start + insert.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError(ERROR_TEXT.COMMENT_EMPTY);
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setError(ERROR_TEXT.COMMENT_TOO_LONG);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(toMarkup(text, mentions));
      if (!initial) {
        setText("");
        setMentions([]);
      }
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setPending(false);
    }
  }

  const listboxOpen = query !== null && options.length > 0;

  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-body`} className="sr-only">
        {initial ? "Edit comment" : "Add a comment"}
      </label>
      <div className="relative">
        <Textarea
          ref={textareaRef}
          id={`${id}-body`}
          value={text}
          placeholder={initial ? undefined : "Add a comment. Type @ to mention someone."}
          rows={initial ? 3 : 3}
          maxLength={MAX_LENGTH + 200}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          role="combobox"
          aria-expanded={listboxOpen}
          aria-controls={`${id}-mentions`}
          aria-autocomplete="list"
          aria-activedescendant={listboxOpen ? `${id}-mention-${active}` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
            detectMention(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={(event) => {
            if (listboxOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => (index + 1) % options.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => (index - 1 + options.length) % options.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                pick(options[active]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setQuery(null);
                return;
              }
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {listboxOpen ? (
          <ul
            id={`${id}-mentions`}
            role="listbox"
            aria-label="People you can mention"
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
          >
            {options.map((option, index) => (
              <li
                key={option.memberId}
                id={`${id}-mention-${index}`}
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-table",
                  index === active ? "bg-accent-soft text-accent-strong" : "text-fg hover:bg-hover",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
              >
                <span className="font-medium">{option.fullName}</span>
                {option.jobTitle ? <span className="truncate text-meta text-fg-subtle">{option.jobTitle}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-meta text-danger-strong">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-meta text-fg-subtle">
          Plain text. Ctrl or ⌘ + Enter to send.
          {text.length > MAX_LENGTH - 500 ? ` ${MAX_LENGTH - text.length} characters left.` : ""}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={pending || text.trim().length === 0}>
          {pending ? "Sending…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
