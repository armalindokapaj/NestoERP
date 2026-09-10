import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pricing } from "@/config/marketing";
import { cn } from "@/lib/utils/cn";

/**
 * Plans (design spec §82).
 *
 * Every plan lists every module, because every plan has every module. The tiers
 * differ by the size of the company and the depth of the relationship, which is
 * the only thing that honestly scales.
 */
export function PricingPlans() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {pricing.plans.map((plan) => (
        <article
          key={plan.key}
          className={cn(
            "flex flex-col rounded-xl border bg-surface p-6 shadow-card",
            plan.featured ? "border-accent" : "border-line",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-card font-semibold text-fg">{plan.name}</h3>
            {plan.featured ? (
              <span className="nesto-eyebrow rounded-full bg-accent-soft px-2 py-1 text-accent-strong">
                Most chosen
              </span>
            ) : null}
          </div>

          <p className="mt-3 text-table leading-relaxed text-fg-muted">{plan.summary}</p>

          <div className="mt-6 flex items-baseline gap-2">
            <span className="font-serif text-display leading-none text-fg">{plan.price}</span>
          </div>
          <p className="mt-2 text-meta text-fg-subtle">{plan.period}</p>

          <p className="mt-5 border-t border-line pt-5 text-table font-medium text-fg">
            {plan.seats}
          </p>

          <ul className="mt-4 flex-1 space-y-2.5">
            {plan.features.map((feature) => (
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
            <Link href={plan.cta.href}>{plan.cta.label}</Link>
          </Button>
        </article>
      ))}
    </div>
  );
}
