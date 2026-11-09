import { CircleHelp } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { FoldIntoPageMenu } from "@/components/navigation/page-menu";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/config/modules";
import { helpHref } from "@/lib/help/help-routes";
import { HelpText } from "./help-text";

/**
 * The module's Help entry (AUD-05 §7, UX-16), quieter than any of the
 * header's actions: a plain link, in the menu as on the page, so it works by
 * keyboard and touch alike (44px under touch, from Button), opens the
 * module's help page and never a tour or an overlay. The help text itself is
 * loaded only when that page is opened, never with the module.
 *
 * Its visible word is "Help"; the accessible name adds the module, so a
 * screen-reader list of links says whose help it is.
 *
 * It is not drawn here, at any width: it is the Help item of the page's ⋯
 * menu, right after the page's title (below `lg` at the end of the title row;
 * components/navigation/page-menu.tsx). Where nothing on the page can hold
 * it, it is drawn here.
 */
export function HelpEntry({ moduleKey, moduleLabel }: { moduleKey: ModuleKey; moduleLabel: string }) {
  const href = helpHref(moduleKey);
  return (
    <FoldIntoPageMenu
      item={{
        kind: "link",
        href,
        label: (
          <>
            <HelpText k="help" />
            <span className="sr-only"><HelpText k="helpFor" values={{ module: moduleLabel }} /></span>
          </>
        ),
      }}
    >
      <Button asChild variant="ghost" size="sm">
        <Link href={href} data-testid="module-help-entry">
          <CircleHelp aria-hidden="true" />
          <HelpText k="help" />
          <span className="sr-only"><HelpText k="helpFor" values={{ module: moduleLabel }} /></span>
        </Link>
      </Button>
    </FoldIntoPageMenu>
  );
}
