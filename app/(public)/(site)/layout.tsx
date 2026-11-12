import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteIndex } from "@/components/marketing/site-index";
import { SiteMasthead } from "@/components/marketing/site-masthead";
import { siteRibbon } from "@/config/marketing";
import { MODULE_GROUPS, moduleList } from "@/config/modules";
import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";
import { getSiteCopy, getTranslations } from "@/lib/i18n/server";

/**
 * The public site shell (design spec §82; UI-05 §2).
 *
 * A nested group inside (public) so that the marketing pages share the Ribbon
 * masthead and the footer while sign-in, recovery and the application stay
 * bare — an authentication screen with a marketing navigation is an
 * invitation to wander off mid-task.
 *
 * The site is written in every interface language and reads the same cookie as
 * the application, so it inherits the document's `lang` from the root layout. A
 * visitor who picks a language in the masthead signs in to NESTO in it.
 *
 * Every page is a sheet (UI-05 §9): its sections are numbered in their bars,
 * and from xl the index rail and the 0–100 ruler stand at the right edge, the
 * page and the footer kept clear of them.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [copy, tModules, tRoles] = await Promise.all([getSiteCopy(), getTranslations("modules"), getTranslations("roles")]);

  // The Modules tab is the registry, named in the reader's language.
  const moduleZones = MODULE_GROUPS.map((group) => ({
    key: group,
    title: copy.moduleZones[group].title,
    items: moduleList
      .filter((definition) => definition.group === group && definition.inNavigation !== false)
      .map((definition) => ({ key: definition.key, label: tModules(`${definition.key}.label`), icon: definition.icon })),
  }));
  const roles = siteRibbon.solutions.roles.map((key) => ({ key, label: tRoles(`${key}.label`) }));

  return (
    <div className="nesto-site flex min-h-dvh flex-col bg-canvas">
      <SiteMasthead
        copy={copy.header}
        ribbon={copy.ribbon}
        moduleZones={moduleZones}
        roles={roles}
        roleCount={MEMBERSHIP_ROLE_KEYS.length}
      />
      <div className="flex flex-1 flex-col xl:pr-[224px]">
        <main className="site-sheet flex-1">{children}</main>
        <SiteFooter />
      </div>
      <SiteIndex copy={copy.sheet} />
    </div>
  );
}
