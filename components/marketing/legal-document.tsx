import { Container, PageIntro } from "@/components/marketing/section";
import { getSiteCopy } from "@/lib/i18n/server";
import type { LegalDocument } from "@/lib/i18n/site";

/**
 * A legal summary page.
 *
 * Both documents share one layout because they are the same kind of reading:
 * short numbered sections in a single column, with the caveat about what is and
 * is not binding kept at the top where it cannot be missed.
 */
export async function LegalDocumentPage({ document }: { document: LegalDocument }) {
  const copy = await getSiteCopy();

  return (
    <>
      <PageIntro eyebrow={document.eyebrow} title={document.title} lead={document.lead}>
        <p className="nesto-eyebrow text-fg-subtle">{copy.legal.lastUpdated} · {document.updated}</p>
      </PageIntro>

      <section className="bg-canvas">
        <Container className="py-12 sm:py-16 lg:py-20">
          <p className="max-w-2xl border-[1.5px] border-dashed border-fg p-5 text-table leading-relaxed text-fg-muted">
            {document.note}
          </p>

          <div className="mt-14 space-y-12">
            {document.sections.map((section, index) => (
              <article
                key={section.title}
                className="grid gap-5 border-t border-fg pt-8 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:gap-12"
              >
                <div>
                  <p aria-hidden="true" className="nesto-numeral text-[56px]">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h2 className="mt-3 text-[24px] leading-tight text-fg font-display">{section.title}</h2>
                </div>
                <div className="max-w-2xl space-y-4">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-body leading-relaxed text-fg-muted">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
