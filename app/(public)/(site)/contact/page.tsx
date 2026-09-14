import type { Metadata } from "next";
import Link from "next/link";

import { ContactForm } from "@/components/marketing/contact-form";
import { Container, PageIntro } from "@/components/marketing/section";
import { contactChannels } from "@/config/marketing";
import { getSiteCopy } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return (await getSiteCopy()).meta.contact;
}

/**
 * Contact (design spec §82).
 *
 * The form is the page. Channels sit beside it for anyone who would rather use
 * their own mail client, and no closing call to action follows — a visitor who
 * reached this page has already answered it.
 */
export default async function ContactPage() {
  const copy = await getSiteCopy();
  const { contact } = copy;

  return (
    <>
      <PageIntro eyebrow={contact.eyebrow} title={contact.title} lead={contact.lead} />

      <section className="bg-canvas">
        <Container className="py-16 sm:py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-16">
            <ContactForm copy={contact.form} replyTime={copy.replyTime} />

            <aside className="space-y-10">
              <div>
                <h2 className="nesto-eyebrow text-fg-subtle">{contact.writeDirectly}</h2>
                <ul className="mt-5 space-y-5">
                  {contactChannels.map((channel) => (
                    <li key={channel.key} className="border-t border-line pt-4">
                      <p className="text-table font-medium text-fg">
                        {contact.channels[channel.key].label}
                      </p>
                      <a
                        href={`mailto:${channel.email}`}
                        className="mt-1 block text-body text-accent-strong underline-offset-4 hover:underline"
                      >
                        {channel.email}
                      </a>
                      <p className="mt-1.5 text-meta text-fg-subtle">
                        {contact.channels[channel.key].note}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5">
                <h2 className="text-card font-semibold text-fg">{contact.account.title}</h2>
                <p className="mt-2 text-table leading-relaxed text-fg-muted">
                  {contact.account.copy}
                </p>
                <Link
                  href="/login"
                  className="mt-4 inline-block text-table font-medium text-accent-strong underline-offset-4 hover:underline"
                >
                  {contact.account.link}
                </Link>
              </div>

              <p className="text-meta leading-relaxed text-fg-subtle">
                {copy.category}. {copy.summary}
              </p>
            </aside>
          </div>
        </Container>
      </section>
    </>
  );
}
