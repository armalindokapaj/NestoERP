import type { Locale } from "@/lib/i18n/config";
import { fill, type PricingCopy } from "@/lib/i18n/site/pricing-configurator";
import { formatEuros, moduleGroups, priceExamples } from "@/lib/marketing/price-book";
import type { PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";

/**
 * Every module of the NESTO Platform with its rates — for each company, at
 * most for a group, for each user, a month — by group, as a drawing's
 * schedule, then the monthly minimum and what a few typical buyers pay
 * (docs/pricing-modules.md). Read from the live price book like the bill of
 * quantities, so a rate changed by the Platform Admin changes here too; a
 * book that sells everything in the base shows nothing here.
 */
export function ModuleSchedule({ config, copy, locale }: { config: PublicPricingConfig; copy: PricingCopy; locale: Locale }) {
  const groups = moduleGroups(config);
  if (!groups.some((entry) => entry.modules.some((row) => !row.included))) return null;
  const examples = priceExamples(config);
  const minimum = config.foundations.find((row) => row.id === "NESTO_PLATFORM")?.minimumMonthlyCents ?? 0;
  const words = copy.schedule;
  const name = (id: string, fallback: string) => copy.moduleText[id]?.name ?? fallback;
  const cell = "border border-fg px-3.5 py-3 text-left align-top";
  const figure = (cents: number) => (cents > 0 ? <span className="text-[26px] leading-none tabular-nums font-display">{formatEuros(cents, locale)}</span> : <span className="text-fg-subtle">—</span>);

  return (
    <div className="flex flex-col gap-10">
      <table className="w-full border-collapse border-[1.5px] border-fg bg-surface" data-testid="module-schedule">
        <thead>
          <tr>
            <th scope="col" className={`${cell} site-tb-k font-normal`}>{words.columns.module}</th>
            <th scope="col" className={`${cell} site-tb-k font-normal max-md:hidden`}>{words.columns.covers}</th>
            <th scope="col" className={`${cell} site-tb-k font-normal`}>{words.columns.company}</th>
            <th scope="col" className={`${cell} site-tb-k font-normal`}>{words.columns.group}</th>
            <th scope="col" className={`${cell} site-tb-k font-normal`}>{words.columns.user}</th>
          </tr>
        </thead>
        {groups.map((entry) => (
          <tbody key={entry.group}>
            <tr>
              <th scope="colgroup" colSpan={5} className="border border-fg bg-canvas px-3.5 py-2 text-left font-mono text-micro font-medium uppercase tracking-[0.12em] text-fg-subtle">
                {copy.groups[entry.group] ?? entry.group}
              </th>
            </tr>
            {entry.modules.map((row) => {
              const covers = copy.moduleText[row.id]?.short ?? row.short;
              return (
                <tr key={row.id} data-module={row.id}>
                  <th scope="row" className={`${cell} text-body font-medium`}>
                    {name(row.id, row.name)}
                    <span className="mt-1 block text-meta font-normal text-fg-muted md:hidden">{covers}</span>
                  </th>
                  <td className={`${cell} text-table text-fg-muted max-md:hidden`}>{covers}</td>
                  {row.included ? (
                    <td colSpan={3} className={`${cell} whitespace-nowrap`}>
                      <span className="font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-muted">{words.inBase}</span>
                    </td>
                  ) : (
                    <>
                      <td className={`${cell} whitespace-nowrap`}>{figure(row.perCompanyCents)}</td>
                      <td className={`${cell} whitespace-nowrap`}>{figure(row.groupCapCents)}</td>
                      <td className={`${cell} whitespace-nowrap`}>{figure(row.perUserCents)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>

      {examples.length > 0 ? (
        <section aria-labelledby="price-examples">
          <h3 id="price-examples" className="text-[28px] leading-none text-fg sm:text-[36px] font-display">{words.examplesTitle}</h3>
          <p className="mt-2 max-w-2xl text-body text-fg-muted">{words.examplesNote}</p>
          {minimum > 0 ? <p className="mt-1 max-w-2xl text-body text-fg-muted" data-testid="minimum-note">{fill(words.minimumNote, { price: formatEuros(minimum, locale) })}</p> : null}
          <ul className="mt-6 grid border-l-[1.5px] border-t-[1.5px] border-fg sm:grid-cols-2 xl:grid-cols-4" data-testid="price-examples">
            {examples.map((example) => (
              <li key={example.key} className="flex flex-col gap-3 border-b-[1.5px] border-r-[1.5px] border-fg bg-surface p-5" data-example={example.key}>
                <h4 className="text-card font-semibold text-fg">{words.examples[example.key].title}</h4>
                <p className="text-table text-fg-muted">{words.examples[example.key].body}</p>
                <p className="font-mono text-micro uppercase tracking-[0.1em] text-fg-subtle">
                  {fill(example.companies === 1 ? words.setupOne : words.setupGroup, { companies: example.companies, projects: example.projects, users: example.users })}
                </p>
                <p className="mt-auto flex items-baseline gap-1.5 border-t border-line pt-3">
                  <span className="text-[34px] leading-none tabular-nums text-fg font-display">{formatEuros(example.monthlyCents, locale)}</span>
                  <span className="text-meta text-fg-muted">{words.perMonth}</span>
                  {example.atMinimum ? <span className="ml-auto font-mono text-micro uppercase tracking-[0.1em] text-fg-subtle">{words.atMinimum}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
