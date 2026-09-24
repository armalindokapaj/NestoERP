import Link from "@/components/navigation/nav-link";

import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

/**
 * A person, wherever NESTO shows one (E-08 §2.2, §5-§8, §71; ADR 0008).
 *
 * The one way a name or avatar leads to its profile. Give it the person's id
 * when the record has it; otherwise the id the record keeps — a membership, a
 * login or an employment — and the link goes through `/people/member/…` (or
 * `user/…`, `employee/…`), which finds the person in the reader's group and
 * sends them to the canonical `/people/[personId]`. Whether the reader may open
 * that profile is the profile's rule, checked there: a link never grants it.
 *
 * No module builds a profile link of its own (§7): a test holds that.
 */

export type PersonRef = {
  personId?: string | null;
  memberId?: string | null;
  userId?: string | null;
  employeeId?: string | null;
};

/**
 * Where a reference leads: the profile itself, or the route that finds it; a
 * `tab` opens that section of the profile. Null when the record names nobody.
 */
export function personHref(ref: PersonRef, tab?: string): string | null {
  const section = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  if (ref.personId) return `/people/${ref.personId}${section}`;
  if (ref.memberId) return `/people/member/${ref.memberId}${section}`;
  if (ref.userId) return `/people/user/${ref.userId}${section}`;
  if (ref.employeeId) return `/people/employee/${ref.employeeId}${section}`;
  return null;
}

/**
 * A membership's own page on Team, where a login's access in one company is
 * managed (deactivated, its role changed). An action on the access, not a link
 * to the person: a name still goes through `PersonLink`.
 */
export function membershipHref(memberId: string): string {
  return `/team/${memberId}`;
}

export type PersonLinkProps = PersonRef & {
  /** The name to show; the record's snapshot of it when there is one. */
  name: string | null | undefined;
  /** The photo's URL when the data carries it (`photoUrl`); otherwise initials. */
  photoUrl?: string | null;
  /** `name` (default), `avatar` alone, `name-avatar`, or `compact` (a small avatar and the name). */
  variant?: "name" | "avatar" | "name-avatar" | "compact";
  /** A job title or a company, shown on hover (§42). */
  detail?: string | null;
  /**
   * The reader may not open this person (§6): `true` shows the name without a
   * link; `"hidden"` shows "Restricted user" where even the name is withheld.
   */
  restricted?: boolean | "hidden";
  /** Opens a section of the profile, e.g. `workforce` from a crew list. */
  tab?: string;
  className?: string;
};

export function PersonLink({ name, photoUrl, variant = "name", detail, restricted, tab, className, ...ref }: PersonLinkProps) {
  if (restricted === "hidden") return <span className={cn("text-fg-muted", className)}>Restricted user</span>;
  const label = name?.trim() || "Unknown";
  const parts = label.split(/\s+/);
  const href = restricted ? null : personHref(ref, tab);
  const title = detail ? `${label} — ${detail}` : label;

  const avatar = variant === "name" ? null : <Avatar firstName={parts[0]} lastName={parts.length > 1 ? parts[parts.length - 1] : null} src={photoUrl ?? null} size={variant === "avatar" ? "md" : "sm"} />;
  const body = (
    <>
      {avatar}
      {variant === "avatar" ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </>
  );
  const layout = cn(variant === "name" ? "inline" : "inline-flex min-w-0 items-center gap-2", variant === "compact" && "text-meta", className);

  return href ? (
    <Link href={href} title={title} className={cn(layout, "font-medium text-fg hover:text-accent-strong hover:underline")} data-person-link="">
      {body}
    </Link>
  ) : (
    <span title={title} className={cn(layout, "font-medium text-fg")}>
      {body}
    </span>
  );
}
