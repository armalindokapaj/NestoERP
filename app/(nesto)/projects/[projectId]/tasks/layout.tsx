import { ModuleMessages } from "@/components/i18n/module-messages";

/**
 * The tab shows the Tasks list itself; on a phone a card's swipe-to-complete
 * reads the tasks dictionary in the browser, so the tab loads it, as the Tasks
 * module's own layout does.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["tasks"]}>{children}</ModuleMessages>;
}
