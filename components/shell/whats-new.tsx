import { RELEASE_NOTES } from "@/config/release-notes";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";

/** What's New (UI-01 §10.2): the published entries, newest first, or an honest empty state before the first. */
export async function WhatsNewPage() {
  const t = await getTranslations("shell");
  const locale = await getLocale();
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="whats-new">
      <PageHeader title={t("account.whatsNew")} description={t("account.whatsNewIntro")} />
      {RELEASE_NOTES.length === 0 ? (
        <EmptyState title={t("account.whatsNewEmptyTitle")} description={t("account.whatsNewEmptyBody")} />
      ) : (
        RELEASE_NOTES.map((note) => (
          <article key={note.id} className="nesto-card space-y-2 p-5" aria-labelledby={`note-${note.id}`}>
            <p className="text-meta text-fg-subtle"><time dateTime={note.date}>{formatDate(note.date)}</time></p>
            <h2 id={`note-${note.id}`} className="text-card font-semibold text-fg">{note.title[locale]}</h2>
            {note.body[locale].map((paragraph) => <p key={paragraph} className="text-body text-fg-muted">{paragraph}</p>)}
          </article>
        ))
      )}
    </div>
  );
}
