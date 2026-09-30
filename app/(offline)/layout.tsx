import { ModuleMessages } from "@/components/i18n/module-messages";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The offline workspace's frame (MOB-09 §65). No application shell, no server
 * data: nothing here is read per person, so the one page this renders can be
 * kept by the service worker and opened with no network. Middleware still
 * requires a session to fetch it the first time.
 */
export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleMessages namespaces={["offline"]}>
      <TooltipProvider delayDuration={200}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </ModuleMessages>
  );
}
