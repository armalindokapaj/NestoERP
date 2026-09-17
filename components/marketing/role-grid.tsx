import { gridColumns, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { ROLE_KEYS, roles, type RoleKey } from "@/config/roles";
import { getSiteCopy, getTranslations } from "@/lib/i18n/server";
import { configLabel } from "@/lib/i18n/site";
import { cn } from "@/lib/utils/cn";

/**
 * The eighteen roles, read from config/roles.ts and named as the interface
 * dictionary names them, so the site and the product agree in every language.
 *
 * The code beside each label is the role number the specification uses. It is
 * kept on the public site on purpose: it says, quietly, that the roles are a
 * defined system rather than a list someone brainstormed.
 */
export async function RoleGrid({
  roleKeys = ROLE_KEYS as readonly RoleKey[] as RoleKey[],
  className,
}: {
  roleKeys?: RoleKey[];
  className?: string;
}) {
  const [copy, t] = await Promise.all([getSiteCopy(), getTranslations("roles")]);

  return (
    <ul
      className={cn(hairlineGrid, gridColumns(roleKeys.length), className)}
    >
      {roleKeys.map((key) => {
        const role = roles[key];
        return (
          <li key={key} className={cn(hairlineCell, "p-5 transition-colors hover:bg-row-hover")}>
            <div className="flex items-baseline gap-2.5">
              <span className="text-micro tabular-nums text-fg-subtle">{role.code}</span>
              <h3 className="text-card font-semibold text-fg">{t(`${key}.label`)}</h3>
            </div>
            <p className="nesto-eyebrow mt-2 text-fg-subtle">
              {configLabel(copy, "departments", role.department)}
            </p>
            <p className="mt-2.5 text-table leading-relaxed text-fg-muted">
              {t(`${key}.description`)}
            </p>
            {role.readOnly ? (
              <p className="mt-3 text-micro font-medium text-fg-subtle">
                {copy.rolesSection.readOnly}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
