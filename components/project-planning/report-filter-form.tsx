"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useRouter } from "@/components/navigation/guarded-router";

/**
 * The milestone report's filters (PRD #44 §165), sent as a guarded navigation
 * (AUD-03 §4): the same page with other filters replaces the planning settings
 * form below it, so a change there is asked about in the app's own prompt
 * rather than lost to a full reload. The query string is what the native GET
 * submit would have sent.
 */
export function ReportFilterForm({ children, ...props }: Omit<React.ComponentProps<"form">, "onSubmit" | "method" | "action">) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <form
      method="get"
      {...props}
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams();
        for (const [name, value] of new FormData(event.currentTarget)) if (typeof value === "string") query.append(name, value);
        const search = query.toString();
        router.push(search ? `${pathname}?${search}` : pathname);
      }}
    >
      {children}
    </form>
  );
}
