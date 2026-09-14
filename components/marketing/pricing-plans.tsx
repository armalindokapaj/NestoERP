import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pricing } from "@/config/marketing";
import { getLocale, getSiteCopy } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

/**
 * Plans (design spec §82).
 *
 * Every plan lists every module, because every plan has every module. The tiers
 * differ by the size of the company and the depth of the relationship, which is
 * the only thing that honestly scales.
 *
 * Figures come from config/marketing.ts and are written the way the reader's
 * language writes money — €390 in English, 390 € in Albanian.
 */
export async function PricingPlans() {
  const [locale, copy] = await Promise.all([getLocale(), getSiteCopy()]);
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: pricing.currency,
    maximumFractionDigits: 0,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {pricing.plans.map((plan) => {
        const words = copy.pricing.plans[plan.key];

        return (
          <article
            key={plan.key}
            className={cn(
              "flex flex-col rounded-xl border bg-surface p-6 shadow-card",
              plan.featured ? "border-accent" : "border-line",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-card font-semibold text-fg">{words.name}</h3>
              {plan.featured ? (
                <span className="nesto-eyebrow rounded-full bg-accent-soft px-2 py-1 text-accent-strong">
                  {copy.pricing.mostChosen}
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-table leading-relaxed text-fg-muted">{words.summary}</p>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="font-serif text-display leading-none text-fg">
                {plan.monthly === null ? copy.pricing.bespoke : money.format(plan.monthly)}
              </span>
            </div>
            <p className="mt-2 text-meta text-fg-subtle">{words.period}</p>

            <p className="mt-5 border-t border-line pt-5 text-table font-medium text-fg">
              {words.seats}
            </p>

            <ul className="mt-4 flex-1 space-y-2.5">
              {words.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-table text-fg-muted">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              asChild
              variant={plan.featured ? "primary" : "secondary"}
              size="lg"
              className="mt-7 w-full"
            >
              <Link href="/contact">{words.cta}</Link>
            </Button>
          </article>
        );
      })}
    </div>
  );
}
