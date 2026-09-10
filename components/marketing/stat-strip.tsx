import { gridColumns, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { stats } from "@/config/marketing";
import { cn } from "@/lib/utils/cn";

/**
 * Four figures about the product itself.
 *
 * Deliberately not social proof. NESTO does not have thousands of logos to
 * borrow, and inventing them would be the first dishonest thing on the page —
 * so the numbers describe what the platform is instead of who else uses it.
 */
export function StatStrip({ className }: { className?: string }) {
  return (
    <dl
      className={cn(hairlineGrid, "grid-cols-2", gridColumns(stats.length), className)}
    >
      {stats.map((stat) => (
        <div key={stat.label} className={cn(hairlineCell, "p-5")}>
          <dt className="nesto-eyebrow text-fg-subtle">{stat.label}</dt>
          <dd className="mt-3 font-serif text-display leading-none text-fg">{stat.figure}</dd>
          <p className="mt-3 text-table leading-relaxed text-fg-muted">{stat.note}</p>
        </div>
      ))}
    </dl>
  );
}
