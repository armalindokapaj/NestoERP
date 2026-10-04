import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/3d/viewer/utils";

export function DropdownPanel({
  align = "right",
  openUpward = false,
  width = "w-56",
  role = "menu",
  className,
  children,
}: {
  align?: "left" | "right";
  openUpward?: boolean;
  width?: string;
  role?: "menu" | "listbox";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className={cn(
        "absolute z-40 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 shadow-[var(--shadow-2)]",
        width,
        align === "right" ? "right-0" : "left-0",
        openUpward ? "bottom-full mb-2" : "top-full mt-2",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DropdownSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
      {children}
    </p>
  );
}

export function DropdownSeparator() {
  return <div className="my-1.5 h-px bg-surface-muted" aria-hidden="true" />;
}

type DropdownMenuItemBaseProps = {
  icon?: React.ReactNode;
  selected?: boolean;
  variant?: "default" | "danger";
  role?: "menuitem" | "menuitemradio" | "option";
  className?: string;
  children: React.ReactNode;
};

type DropdownMenuItemAsButton = DropdownMenuItemBaseProps & {
  href?: undefined;
  onClick?: () => void;
};

type DropdownMenuItemAsLink = DropdownMenuItemBaseProps & {
  href: string;
  onClick?: () => void;
};

export function DropdownMenuItem(props: DropdownMenuItemAsButton | DropdownMenuItemAsLink) {
  const { icon, selected, variant = "default", role = "menuitem", className, children, onClick } = props;
  const content = (
    <>
      {icon}
      <span className="flex-1 text-left">{children}</span>
      {selected && <Check className="h-4 w-4 shrink-0 text-accent-strong" />}
    </>
  );
  const sharedClassName = cn(
    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
    variant === "danger" ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-surface-muted",
    className
  );

  if ("href" in props && props.href) {
    return (
      <Link
        href={props.href}
        onClick={onClick}
        role={role}
        aria-checked={role === "menuitemradio" ? selected : undefined}
        className={sharedClassName}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      role={role}
      aria-checked={role === "menuitemradio" ? selected : undefined}
      aria-selected={role === "option" ? selected : undefined}
      className={sharedClassName}
    >
      {content}
    </button>
  );
}
