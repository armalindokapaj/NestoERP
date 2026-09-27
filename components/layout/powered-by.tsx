import { DEMO_DISCLAIMER } from "@/components/dashboard/demo-disclaimer";
import { brand } from "@/config/brand";

/**
 * The foot of the navigation (OW §6, §71): NESTO as secondary branding, small
 * and muted, under the customer's own identity at the top. A demonstration
 * tenant says so here too (D-01 §68, §69) — the notice left the top bar with
 * the workspace switcher (OW §19), and the dashboard hero still carries it.
 */
export function PoweredBy({ isDemo, version = false }: { isDemo: boolean; version?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="powered-by">
      <p className="min-w-0 truncate text-micro text-fg-subtle">
        Powered by <span className="font-medium tracking-[0.12em] text-fg-muted">{brand.name}</span>
        {version ? <span className="ml-1.5 tabular-nums">{brand.version}</span> : null}
      </p>
      {isDemo ? (
        <span
          title={DEMO_DISCLAIMER}
          aria-label={DEMO_DISCLAIMER}
          data-testid="demo-notice"
          className="inline-flex shrink-0 rounded-full border border-line px-2 py-px text-micro font-medium text-fg-muted"
        >
          Demo data
        </span>
      ) : null}
    </div>
  );
}
