"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { TriangleAlert } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { modules as moduleRegistry, isModuleKey } from "@/config/modules";
import { setModuleEnabledAction } from "@/lib/actions/settings";
import type { CompanyModuleDTO } from "@/lib/modules/settings/module-toggle.service";

/**
 * Company module activation (PRD #24 §48, §55, §165).
 *
 * A switch rather than a form: this is an immediate on/off setting, and the
 * page has to re-render afterwards anyway because disabling a module changes
 * the navigation the reader is looking at.
 *
 * A module that cannot be turned off is disabled here *and* says why, taken
 * from the service's own blocker list rather than a rule copied into the
 * interface. The server refuses it regardless — this only saves somebody the
 * round trip (PRD #24 §225).
 */
export function ModuleToggleList({ modules }: { modules: CompanyModuleDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);
  const t = useTranslations("settings");
  const tModules = useTranslations("modules");

  // The registry's modules are named in the reader's language; anything the
  // service returns that the registry does not know keeps its stored name.
  const nameOf = (module: CompanyModuleDTO) =>
    isModuleKey(module.key) ? tModules(`${module.key}.label`) : module.name;

  async function toggle(module: CompanyModuleDTO, next: boolean) {
    setPendingKey(module.key);
    const result = await setModuleEnabledAction(module.key, next);
    setPendingKey(null);

    if (result.ok) {
      const values = { name: nameOf(module) };
      toast({
        title: next ? t("modules.enabledToast", values) : t("modules.disabledToast", values),
        tone: "success",
      });
      // Navigation, dashboards and every module guard read from this, so the
      // whole shell has to be re-fetched, not just this list.
      router.refresh();
    } else {
      toast({ title: result.message, tone: "danger" });
    }
  }

  return (
    <div className="nesto-card divide-y divide-line">
      {modules.map((module) => {
        const definition = isModuleKey(module.key) ? moduleRegistry[module.key] : null;
        const Icon = getIcon(definition?.icon ?? "Boxes");
        const name = nameOf(module);

        // Blockers explain why something cannot be turned *off*, so they never
        // stand in the way of turning one back on.
        const blocker = module.enabled ? module.blockers[0] : undefined;
        // Outside the company's plan the switch has no effect, so it cannot be turned on (Admin Modules PRD #4 §3).
        const notEntitled = !module.entitled && !module.enabled;
        const disabled = !module.canManage || pendingKey !== null || Boolean(blocker) || notEntitled;

        return (
          <div key={module.key} className="flex items-center gap-3 px-5 py-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-hover text-fg-muted">
              <Icon className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-table font-medium text-fg">{name}</p>
              <p className="truncate text-meta text-fg-subtle">
                {definition ? tModules(`${definition.key}.description`) : module.key}
              </p>
              {!module.entitled ? (
                <p className="mt-1 text-meta text-fg-muted">{t("modules.notEntitled")}</p>
              ) : null}
              {blocker ? (
                <p className="mt-1 flex items-start gap-1.5 text-meta text-warning">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  <span>{blocker.message}</span>
                </p>
              ) : null}
            </div>

            {module.canManage ? (
              <Switch
                checked={module.enabled}
                disabled={disabled}
                onCheckedChange={(next) => void toggle(module, next)}
                aria-label={t(module.enabled ? "modules.disable" : "modules.enable", { name })}
              />
            ) : (
              <Badge tone={module.enabled ? "success" : "default"}>
                {module.enabled ? t("modules.enabled") : t("modules.disabled")}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
