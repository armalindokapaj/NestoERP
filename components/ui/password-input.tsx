"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

/**
 * A password field (UI-02 §7.5). Without `reveal` it is the plain field it
 * always was. With it — version 2 — the field carries a Show password control:
 * a toggle whose pressed state is the truth (`aria-pressed`) and is drawn as
 * well as said, named for what it does and tied to the field it acts on. Showing changes only the input's
 * type, so a password manager, paste and the browser's own autofill keep
 * working, and the field goes back to hidden when its form is submitted.
 */
export function PasswordInput({ reveal = false, className, id, ref, ...props }: Omit<React.ComponentProps<"input">, "type"> & { reveal?: boolean }) {
  const t = useTranslations("ui");
  const [shown, setShown] = React.useState(false);
  const field = React.useRef<HTMLInputElement | null>(null);

  // A submitted form never leaves the password on screen behind a pending button.
  React.useEffect(() => {
    if (!reveal) return;
    const form = field.current?.form;
    if (!form) return;
    const hide = () => setShown(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, [reveal]);

  if (!reveal) return <Input id={id} type="password" className={className} ref={ref} {...props} />;

  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        // The control sits inside the field's right edge; the text stops short of it.
        className={cn("pr-11 touch:pr-12", className)}
        {...props}
        ref={(node) => {
          field.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
      />
      {/* Named by its text, not by `aria-label`: a lookup of the field by its label ("Password") finds the field alone. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t("showPassword")}
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown((value) => !value)}
        className={cn("absolute right-1 top-1/2 -translate-y-1/2", shown && "bg-hover text-fg ring-1 ring-inset ring-line-strong")}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        <span className="sr-only">{t("showPassword")}</span>
      </Button>
    </div>
  );
}
