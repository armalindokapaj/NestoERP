import type { Locale } from "@/lib/i18n/config";
import { fill, type SiteCopy } from "@/lib/i18n/site";
import { formatEuros, platformOffer, priceRows } from "@/lib/marketing/price-book";
import type { PricingPromotionConfig, PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";

type Copy = SiteCopy["home"]["prices"];

function offerSentence(promotion: PricingPromotionConfig, copy: Copy): string {
  const periods = promotion.periods.map(({ months, discountPercent }, index) => {
    const free = discountPercent >= 100;
    if (index === 0) return fill(free ? copy.offer.firstFree : copy.offer.firstOff, { n: months, pct: discountPercent });
    return fill(free ? copy.offer.nextFree : copy.offer.nextOff, { n: months, pct: discountPercent });
  });
  return fill(copy.offer.lead, { months: promotion.requiredContractMonths, periods: periods.join(", ") });
}

/**
 * The bill of quantities: every rate in the live price book, as a drawing's
 * schedule (UI-05 §3.5). With no price book it says so and shows no figure —
 * a stale price is worse than none (Modular Pricing PRD §53).
 */
export function PriceBook({ config, copy, locale }: { config: PublicPricingConfig | null; copy: Copy; locale: Locale }) {
  if (!config) {
    return <p role="status" className="border-[1.5px] border-dashed border-fg p-6 text-body text-fg-muted">{copy.unavailable}</p>;
  }

  const offer = platformOffer(config);
  const cell = "border border-fg px-3.5 py-3 text-left align-top";

  return (
    <table className="w-full border-collapse border-[1.5px] border-fg bg-surface" data-testid="price-book">
      <thead>
        <tr>
          <th scope="col" className={`${cell} site-tb-k font-normal`}>{copy.columns.item}</th>
          <th scope="col" className={`${cell} site-tb-k font-normal max-md:hidden`}>{copy.columns.included}</th>
          <th scope="col" className={`${cell} site-tb-k font-normal`}>{copy.columns.rate}</th>
          <th scope="col" className={`${cell} site-tb-k font-normal max-sm:hidden`}>{copy.columns.per}</th>
        </tr>
      </thead>
      <tbody>
        {priceRows(config).map((row) => {
          const words = copy.rows[row.key];
          const price = formatEuros(row.monthlyCents, locale);
          // A further company that brings no people of its own (modules priced per person) has nothing to list.
          const included = row.key === "company" && row.values.users === 0 ? "—" : fill(words.included, row.values);
          return (
            <tr key={row.key}>
              <th scope="row" className={`${cell} text-body font-medium`}>
                {words.item}
                <span className="mt-1 block text-meta font-normal text-fg-muted md:hidden">{included}</span>
                <span className="mt-1 block text-meta font-normal text-fg-muted sm:hidden">{copy.columns.per} {fill(words.per, row.values)}</span>
              </th>
              <td className={`${cell} text-table text-fg-muted tabular-nums max-md:hidden`}>{included}</td>
              <td className={`${cell} whitespace-nowrap`}>
                {row.from ? <span className="mr-1 text-meta text-fg-muted">{copy.from}</span> : null}
                <span className="text-[26px] leading-none tabular-nums sm:text-[30px] font-display">{price}</span>
              </td>
              <td className={`${cell} text-table text-fg max-sm:hidden`}>{fill(words.per, row.values)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} className="border border-fg bg-accent-soft px-3.5 py-3">
            <div id="offer" className="flex scroll-mt-32 flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              {offer ? <span className="text-body font-medium text-fg">{offerSentence(offer, copy)}</span> : <span />}
              <span className="font-mono text-[10px] max-md:text-meta uppercase tracking-[0.12em] text-fg-subtle">{fill(copy.footnote, { version: config.pricingVersion })}</span>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
