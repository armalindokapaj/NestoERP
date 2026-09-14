import { gridColumns, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { lifecycle } from "@/config/marketing";
import { getSiteCopy, getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

/**
 * The build, end to end.
 *
 * Every ERP claims to cover a lifecycle; construction actually has one, and it
 * is the clearest way to say what NESTO holds. Each stage names the modules it
 * runs through, so the promise is checkable against the module list rather than
 * being an abstraction.
 */
export async function Lifecycle({ className }: { className?: string }) {
  const [copy, t] = await Promise.all([getSiteCopy(), getTranslations("modules")]);

  return (
    <ol
      className={cn(hairlineGrid, gridColumns(lifecycle.length), className)}
    >
      {lifecycle.map((stage, index) => (
        <li key={stage.key} className={cn(hairlineCell, "flex flex-col p-6")}>
          <div className="flex items-center gap-2.5">
            <span className="text-micro tabular-nums text-fg-subtle">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span aria-hidden="true" className="h-px w-5 bg-line-strong" />
            <h3 className="text-card font-semibold text-fg">{copy.lifecycle[stage.key].title}</h3>
          </div>

          <p className="mt-3 flex-1 text-table leading-relaxed text-fg-muted">
            {copy.lifecycle[stage.key].copy}
          </p>

          <ul className="mt-4 flex flex-wrap gap-1.5">
            {stage.modules.map((key) => (
              <li
                key={key}
                className="rounded-full border border-line bg-canvas px-2 py-0.5 text-micro text-fg-subtle"
              >
                {t(`${key}.label`)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
