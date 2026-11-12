import { Container, PageIntro, SectionBar, sectionMark } from "@/components/marketing/section";
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

      <section className="border-b border-line bg-canvas">
        <Container className="py-10 sm:py-12">
          <p className="max-w-2xl border-[1.5px] border-dashed border-fg p-5 text-table leading-relaxed text-fg-muted">
            {document.note}
          </p>
        </Container>
      </section>

      {/* Each part is one of the page's numbered sections: its bar names it (UI-05 §9). */}
      {document.sections.map((section) => (
        <section key={section.title} {...sectionMark(section.title)} className="relative border-b border-line bg-canvas">
          <SectionBar label={section.title} />
          <Container className="py-10 sm:py-12 lg:py-14">
            <article className="grid gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:gap-12">
              <h2 className="text-[24px] leading-tight text-fg font-display">{section.title}</h2>
              <div className="max-w-2xl space-y-4">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-body leading-relaxed text-fg-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
            </article>
          </Container>
        </section>
      ))}
    </>
  );
}
