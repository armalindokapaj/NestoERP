import type { Metadata } from "next";
import Link from "next/link";

import { ContactForm } from "@/components/marketing/contact-form";
import { Container, PageIntro } from "@/components/marketing/section";
import { contactPage, site } from "@/config/marketing";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Request access, book a walkthrough, or put a security review in front of your IT team. A person answers.",
};

/**
 * Contact (design spec §82).
 *
 * The form is the page. Channels sit beside it for anyone who would rather use
 * their own mail client, and no closing call to action follows — a visitor who
 * reached this page has already answered it.
 */
export default function ContactPage() {
  return (
    <>
      <PageIntro eyebrow={contactPage.eyebrow} title={contactPage.title} lead={contactPage.lead} />

      <section className="bg-canvas">
        <Container className="py-16 sm:py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-16">
            <ContactForm />

            <aside className="space-y-10">
              <div>
                <h2 className="nesto-eyebrow text-fg-subtle">Or write directly</h2>
                <ul className="mt-5 space-y-5">
                  {contactPage.channels.map((channel) => (
                    <li key={channel.value} className="border-t border-line pt-4">
                      <p className="text-table font-medium text-fg">{channel.label}</p>
                      <a
                        href={`mailto:${channel.value}`}
                        className="mt-1 block text-body text-accent-strong underline-offset-4 hover:underline"
                      >
                        {channel.value}
                      </a>
                      <p className="mt-1.5 text-meta text-fg-subtle">{channel.note}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5">
                <h2 className="text-card font-semibold text-fg">Already have an account?</h2>
                <p className="mt-2 text-table leading-relaxed text-fg-muted">
                  Sign in to your company workspace. Access is provisioned by your administrator, so
                  they are the fastest route to a new account or a changed role.
                </p>
                <Link
                  href="/login"
                  className="mt-4 inline-block text-table font-medium text-accent-strong underline-offset-4 hover:underline"
                >
                  Sign in to NESTO
                </Link>
              </div>

              <p className="text-meta leading-relaxed text-fg-subtle">
                {site.category}. {site.summary}
              </p>
            </aside>
          </div>
        </Container>
      </section>
    </>
  );
}
