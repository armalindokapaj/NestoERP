import { gridColumns, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { lifecycle } from "@/config/marketing";
import { modules } from "@/config/modules";
import { cn } from "@/lib/utils/cn";

/**
 * The build, end to end.
 *
 * Every ERP claims to cover a lifecycle; construction actually has one, and it
 * is the clearest way to say what NESTO holds. Each stage names the modules it
 * runs through, so the promise is checkable against the module list rather than
 * being an abstraction.
 */
export function Lifecycle({ className }: { className?: string }) {
  return (
    <ol
      className={cn(hairlineGrid, gridColumns(lifecycle.length), className)}
    >
      {lifecycle.map((stage) => (
        <li key={stage.step} className={cn(hairlineCell, "flex flex-col p-6")}>
          <div className="flex items-center gap-2.5">
            <span className="text-micro tabular-nums text-fg-subtle">{stage.step}</span>
            <span aria-hidden="true" className="h-px w-5 bg-line-strong" />
            <h3 className="text-card font-semibold text-fg">{stage.title}</h3>
          </div>

          <p className="mt-3 flex-1 text-table leading-relaxed text-fg-muted">{stage.copy}</p>

          <ul className="mt-4 flex flex-wrap gap-1.5">
            {stage.modules.map((key) => (
              <li
                key={key}
                className="rounded-full border border-line bg-canvas px-2 py-0.5 text-micro text-fg-subtle"
              >
                {modules[key].label}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
