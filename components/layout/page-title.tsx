"use client";

import { usePathname } from "next/navigation";

import { moduleForPath } from "@/config/modules";

/**
 * The top bar shows where you are (spec §11). Detail pages keep the module name
 * here and put the record name in their own PageHeader.
 */
export function PageTitle() {
  const pathname = usePathname();
  const activeModule = moduleForPath(pathname);

  return (
    <span className="truncate text-body font-semibold text-fg">
      {activeModule?.label ?? "NESTO"}
    </span>
  );
}
