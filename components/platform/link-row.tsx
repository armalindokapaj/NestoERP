"use client";

import * as React from "react";

import { useRouter } from "@/components/navigation/guarded-router";
import { TableRow } from "@/components/ui/table";

/**
 * A table row that opens its record wherever it is clicked. The row's own link
 * stays the keyboard and screen-reader path; links, buttons and fields inside
 * the row keep doing their own thing, and selecting text is not a click.
 */
export function LinkRow({ href, onClick, className, ...props }: React.ComponentProps<typeof TableRow> & { href: string }) {
  const router = useRouter();
  return (
    <TableRow
      interactive
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("a,button,input,select,textarea,label,[role=button]")) return;
        if (window.getSelection()?.toString()) return;
        if (event.metaKey || event.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
      {...props}
    />
  );
}
