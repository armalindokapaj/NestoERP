import { gridColumns, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import { ROLE_KEYS, roles, type RoleKey } from "@/config/roles";
import { cn } from "@/lib/utils/cn";

/**
 * The sixteen roles, read from config/roles.ts.
 *
 * The code beside each label is the role number the specification uses. It is
 * kept on the public site on purpose: it says, quietly, that the roles are a
 * defined system rather than a list someone brainstormed.
 */
export function RoleGrid({
  roleKeys = ROLE_KEYS as readonly RoleKey[] as RoleKey[],
  className,
}: {
  roleKeys?: RoleKey[];
  className?: string;
}) {
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
              <h3 className="text-card font-semibold text-fg">{role.label}</h3>
            </div>
            <p className="nesto-eyebrow mt-2 text-fg-subtle">{role.department}</p>
            <p className="mt-2.5 text-table leading-relaxed text-fg-muted">{role.description}</p>
            {role.readOnly ? (
              <p className="mt-3 text-micro font-medium text-fg-subtle">Read-only</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
