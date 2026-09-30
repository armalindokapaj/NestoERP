"use client";

import Link from "@/components/navigation/nav-link";
import { useState } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useSignOut } from "@/components/layout/use-sign-out";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fullName, roleAndCompany } from "@/lib/utils/format";

/**
 * The serialisable slice of the user context the menu needs. The full context
 * never crosses to the client — permissions stay on the server.
 */
export type UserMenuUser = {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  roleLabel: string;
  /** The active workspace's name: the company, or the group in the Group workspace. */
  companyName: string;
};

/**
 * Menu items swallow the global focus outline, and `:focus-visible` cannot
 * bring it back: Radix focuses the row under the pointer, so it would ring on
 * every hover. The menu records whether it is driven by keys, and only then
 * draws the ring inside the highlighted row (Profile Menu §24, §34, §35).
 * `outline-solid` is needed: `outline-none` also empties the style variable
 * that `outline-2` reads.
 */
const keyboardFocus =
  "group-data-[input=keyboard]/menu:focus:outline-solid group-data-[input=keyboard]/menu:focus:outline-2 group-data-[input=keyboard]/menu:focus:-outline-offset-2";

/**
 * Top-bar account menu (PRD #3 §20, Profile Menu PRD §2).
 *
 * Person-focused, never a workspace switcher (§49, §50): the header is who is
 * signed in — name, then `Role · Company` — and opens their own Profile; then
 * Settings; then Logout, red before any hover. Everything shown comes from the
 * server-rendered context, so opening the menu fetches nothing (§73, §77), and
 * a workspace change or a demo-user switch re-renders it with the new identity.
 */
export function UserMenu({ user }: { user: UserMenuUser }) {
  const t = useTranslations("shell");
  const [input, setInput] = useState<"keyboard" | "pointer">("pointer");
  const [menuOpen, setMenuOpen] = useState(false);

  const name = fullName(user.firstName, user.lastName);
  const context = roleAndCompany(user.roleLabel, user.companyName);

  // Stayed: back to the page, not to a menu left open behind the question.
  const { signOut: handleLogout, signingOut } = useSignOut(() => setMenuOpen(false));

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        // 44px under touch; on a phone the chevron gives way so the bar fits 320px (AUD-04 §4).
        className="flex items-center justify-center gap-2 rounded-md p-1 pr-1.5 transition-colors hover:bg-hover data-[state=open]:bg-hover touch:min-h-11 touch:min-w-11 max-md:pr-1"
        aria-label={t("openUserMenu")}
        onKeyDown={() => setInput("keyboard")}
        onPointerDown={() => setInput("pointer")}
      >
        <Avatar firstName={user.firstName} lastName={user.lastName} src={user.avatarUrl} size="md" />
        <span className="hidden min-w-0 text-left lg:block">
          <span className="block truncate text-table font-medium leading-tight text-fg">{name}</span>
          <span className="block truncate text-micro leading-tight text-fg-muted">{user.roleLabel}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle max-md:hidden" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="group/menu w-80 max-w-[calc(100vw-2rem)]"
        data-testid="user-menu"
        data-input={input}
        onKeyDown={() => setInput("keyboard")}
        onPointerMove={() => setInput("pointer")}
      >
        {/*
         * The whole identity block is one link to the signed-in person's own
         * Profile (§9-§11, §25). /settings/profile reads the session, never a
         * parameter, so it cannot open anyone else. Two lines, not three (§4, §6).
         */}
        <DropdownMenuItem asChild className={`gap-3 py-2.5 ${keyboardFocus} focus:outline-ring`}>
          <Link href="/settings/profile" data-testid="user-menu-profile">
            <Avatar firstName={user.firstName} lastName={user.lastName} src={user.avatarUrl} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-card font-semibold leading-snug text-fg" title={name} data-testid="user-menu-name">
                {name}
              </span>
              {context ? (
                <span className="block truncate text-table text-fg-muted" title={context} data-testid="user-menu-context">
                  {context}
                </span>
              ) : null}
              <span className="sr-only">{t("myProfile")}</span>
            </span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/*
         * Offered to everyone, not just roles with Settings module access
         * (PRD #5 §39): /settings lists exactly the sections the reader may
         * open, and Appearance is personal, so every role lands on a page with
         * something on it. Gating this link on the module was how twelve of
         * the sixteen roles ended up with no way to reach their own theme.
         */}
        <DropdownMenuItem asChild className={`${keyboardFocus} focus:outline-ring`}>
          <Link href="/settings">
            <Settings aria-hidden="true" />
            {t("settings")}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Red by default, not only on hover; the icon and label say it too (§31-§38, §66). */}
        <DropdownMenuItem
          variant="destructive"
          className={`${keyboardFocus} focus:outline-danger-strong`}
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleLogout();
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? t("signingOut") : t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
