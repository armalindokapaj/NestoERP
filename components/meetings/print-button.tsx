"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMeetingsTranslations } from "./meetings-text";

export function PrintButton() {
  const t = useMeetingsTranslations();
  return (
    <Button type="button" size="sm" onClick={() => window.print()}>
      <Printer aria-hidden="true" />
      {t("print.printButton")}
    </Button>
  );
}
