import { ModuleMessages } from "@/components/i18n/module-messages";

/** Calendar's strings for its Client Components; the page guards the module itself. */
export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["calendar"]}>{children}</ModuleMessages>;
}
