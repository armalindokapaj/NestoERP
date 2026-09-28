import { CircleHelp } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/config/modules";
import { helpHref } from "@/lib/help/help-routes";
import { HelpText } from "./help-text";

/**
 * The module's Help entry (AUD-05 §7, UX-16), in the module header beside its
 * actions and quieter than any of them: a plain link, so it works by keyboard
 * and touch alike (44px under touch, from Button), opens the module's help
 * page and never a tour or an overlay. The help text itself is loaded only
 * when that page is opened, never with the module.
 *
 * Its visible word is "Help"; the accessible name adds the module, so a
 * screen-reader list of links says whose help it is.
 */
export function HelpEntry({ moduleKey, moduleLabel }: { moduleKey: ModuleKey; moduleLabel: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={helpHref(moduleKey)} data-testid="module-help-entry">
        <CircleHelp aria-hidden="true" />
        <HelpText k="help" />
        <span className="sr-only"><HelpText k="helpFor" values={{ module: moduleLabel }} /></span>
      </Link>
    </Button>
  );
}
